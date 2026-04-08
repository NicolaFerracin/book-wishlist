import express from 'express'
import cors from 'cors'
import { readBooks, writeBooks } from './storage.js'
import { scrapeAllIsbns, scrapeBook, closeBrowser, type ScrapeOptions } from './scraper.js'

function parseScrapeOptions(query: Record<string, unknown>): ScrapeOptions {
  return {
    amazonDomain: (query.amazonDomain as string) || 'amazon.es',  // closest Amazon to Portugal
    currency: (query.currency as string) || 'EUR',
    country: (query.country as string) || 'pt',                 // BookFinder ship-to destination
  }
}
import type { WishlistBook } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = 3001

// ── Bulk scrape state (persists across client reconnects) ─────────────────────

interface BulkScrapeState {
  running: boolean
  current: number
  total: number
  currentTitle: string
  startedAt: string
  bookStartedAt: string
  log: { title: string; sellers: number; cheapest: { price: number; currency: string } | null; error?: string }[]
  errors: number
}

const scrapeState: BulkScrapeState = {
  running: false,
  current: 0,
  total: 0,
  currentTitle: '',
  startedAt: '',
  bookStartedAt: '',
  log: [],
  errors: 0,
}

let scrapeAborted = false

// ── Books CRUD ────────────────────────────────────────────────────────────────

app.get('/api/books', (_req, res) => {
  res.json(readBooks())
})

app.post('/api/books', (req, res) => {
  const books = readBooks()
  const book: WishlistBook = {
    ...req.body,
    id: Date.now().toString(),
    addedAt: new Date().toISOString(),
    isbns: req.body.isbns ?? [],
    prices: [],
  }
  books.push(book)
  writeBooks(books)
  res.json(book)
})

app.put('/api/books/:id', (req, res) => {
  const books = readBooks()
  const idx = books.findIndex((b) => b.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  books[idx] = { ...books[idx], ...req.body }
  writeBooks(books)
  res.json(books[idx])
})

app.delete('/api/books/:id', (req, res) => {
  const books = readBooks()
  const filtered = books.filter((b) => b.id !== req.params.id)
  writeBooks(filtered)
  res.json({ ok: true })
})

// ── Import ───────────────────────────────────────────────────────────────────

app.post('/api/books/import', (req, res) => {
  const { items } = req.body as { items: { name: string; url?: string; imageUrl?: string; dateAdded?: string; comment?: string }[] }
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' })

  const books = readBooks()
  const existingTitles = new Set(books.map(b => b.title.toLowerCase().trim()))
  let added = 0
  let skipped = 0

  for (const item of items) {
    // Parse "Title by Author (Format)" from Amazon export name
    const formatSuffix = /\s*\([^)]*(?:Hardcover|Paperback|Mass Market|Audio|Kindle|Board book|Spiral|CD|DVD|Blu)[^)]*\)\s*$/i
    const withoutFormat = item.name.replace(formatSuffix, '').trim()
    const byIdx = withoutFormat.lastIndexOf(' by ')
    const title = byIdx !== -1 ? withoutFormat.slice(0, byIdx).trim() : withoutFormat
    const author = byIdx !== -1 ? withoutFormat.slice(byIdx + 4).trim() : ''

    if (existingTitles.has(title.toLowerCase().trim())) { skipped++; continue }

    // Extract ASIN from Amazon URL
    const asinMatch = item.url?.match(/\/dp\/([A-Z0-9]{10})/)
    const asin = asinMatch?.[1]

    let addedAt: string
    try {
      const d = new Date(item.dateAdded ?? '')
      addedAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
    } catch { addedAt = new Date().toISOString() }

    const book: WishlistBook = {
      id: Date.now().toString() + added,
      title,
      author,
      isbn: asin && /^\d{10}$/.test(asin) ? asin : undefined,
      isbns: asin && /^\d{10}$/.test(asin) ? [asin] : [],
      coverUrl: item.imageUrl || undefined,
      notes: item.comment?.trim() || undefined,
      addedAt,
      prices: [],
      asin,
    }

    books.push(book)
    existingTitles.add(title.toLowerCase().trim())
    added++
  }

  writeBooks(books)
  res.json({ added, skipped })
})

// ── Price scraping ────────────────────────────────────────────────────────────

app.post('/api/books/:id/scrape', async (req, res) => {
  const books = readBooks()
  const book = books.find((b) => b.id === req.params.id)
  if (!book) return res.status(404).json({ error: 'Not found' })

  if (book.isbns.length === 0 && !book.isbn && !book.asin) {
    return res.status(400).json({ error: 'No ISBNs available for this book' })
  }

  const opts = parseScrapeOptions(req.query)
  console.log(`Scraping prices for "${book.title}" (${opts.amazonDomain})...`)
  const prices = await scrapeBook(book, opts)

  const idx = books.findIndex((b) => b.id === req.params.id)
  books[idx].prices = prices
  books[idx].pricesLastChecked = new Date().toISOString()
  writeBooks(books)

  res.json(books[idx])
})

// ── Bulk price scraping (background job + polling) ───────────────────────────
// POST /api/scrape-all         → start a run (or ?force=1 to re-scrape all)
// GET  /api/scrape-all/status  → poll current progress (survives page refresh)

app.get('/api/scrape-all/status', (_req, res) => {
  res.json(scrapeState)
})

app.post('/api/scrape-all/stop', (_req, res) => {
  if (!scrapeState.running) return res.json({ ok: false, message: 'Not running' })
  scrapeAborted = true
  res.json({ ok: true })
})

app.post('/api/scrape-all', (req, res) => {
  if (scrapeState.running) {
    return res.status(409).json({ error: 'Already running' })
  }

  const force = req.query.force === '1'
  const opts = parseScrapeOptions(req.query)
  const books = readBooks()
  const toScrape = books.filter((b) => {
    if (b.isbns.length === 0 && !b.isbn && !b.asin) return false
    if (!force && b.pricesLastChecked) return false
    return true
  })

  if (toScrape.length === 0) {
    return res.json({ started: false, message: 'Nothing to scrape. Use ?force=1 to re-scrape all.' })
  }

  scrapeState.running = true
  scrapeState.current = 0
  scrapeState.total = toScrape.length
  scrapeState.currentTitle = toScrape[0].title
  scrapeState.startedAt = new Date().toISOString()
  scrapeState.bookStartedAt = new Date().toISOString()
  scrapeState.log = []
  scrapeState.errors = 0

  scrapeAborted = false
  res.json({ started: true, total: toScrape.length })

  // Run in background — not awaited
  ;(async () => {
    try {
      for (let i = 0; i < toScrape.length; i++) {
        if (scrapeAborted) { console.log('Bulk scrape stopped by user.'); break }
        const book = toScrape[i]
        scrapeState.current = i
        scrapeState.currentTitle = book.title
        scrapeState.bookStartedAt = new Date().toISOString()

        let error: string | undefined
        let totalSellers = 0
        let cheapest: { price: number; currency: string } | null = null

        try {
          const prices = await scrapeBook(book, opts)
          totalSellers = prices.reduce((s, p) => s + p.sellers.length, 0)
          const cheapestSeller = prices.flatMap((p) => p.sellers).sort((a, b) => a.price - b.price)[0]
          cheapest = cheapestSeller ? { price: cheapestSeller.price, currency: cheapestSeller.currency } : null

          const fresh = readBooks()
          const idx = fresh.findIndex((b) => b.id === book.id)
          if (idx !== -1) {
            fresh[idx].prices = prices
            fresh[idx].pricesLastChecked = new Date().toISOString()
            writeBooks(fresh)
          }
        } catch (e) {
          error = (e as Error).message || 'Unknown error'
          scrapeState.errors++
          console.error(`[${i + 1}/${toScrape.length}] ERROR ${book.title.slice(0, 50)}: ${error}`)
        }

        scrapeState.log.push({
          title: book.title,
          sellers: totalSellers,
          cheapest,
          error,
        })

        console.log(`[${i + 1}/${toScrape.length}] ${book.title.slice(0, 50)} — ${totalSellers} sellers${error ? ` (ERROR: ${error})` : ''}`)
      }
    } finally {
      scrapeState.running = false
      scrapeState.current = scrapeState.total
      scrapeState.currentTitle = ''
    }
  })()
})

// Debug endpoint: fetch raw HTML for an ISBN so you can inspect the scraper selectors
app.get('/api/debug-scrape/:isbn', async (req, res) => {
  const url = `https://www.isbns.net/isbn/${req.params.isbn}/`
  const html = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).then((r) => r.text())
  res.type('html').send(html)
})

const server = app.listen(PORT, () => {
  console.log(`Book wishlist server running at http://localhost:${PORT}`)
})

process.on('SIGINT', async () => {
  await closeBrowser()
  server.close()
  process.exit(0)
})
