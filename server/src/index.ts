import express from 'express'
import cors from 'cors'
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { clearAllPrices, readBooks, writeBooks } from './storage.js'
import { log, getLogs, clearLogs } from './logger.js'
import type { WishlistBook } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

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

app.put('/api/books/:id/prices', (req, res) => {
  const books = readBooks()
  const idx = books.findIndex((b) => b.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })

  const { prices, pricesLastChecked } = req.body as Pick<WishlistBook, 'prices' | 'pricesLastChecked'>
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'Invalid prices payload' })

  books[idx].prices = prices
  books[idx].pricesLastChecked = pricesLastChecked || new Date().toISOString()
  writeBooks(books)
  res.json(books[idx])
})

app.delete('/api/prices', (_req, res) => {
  const cleared = clearAllPrices()
  res.json({ cleared })
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
    let title = byIdx !== -1 ? withoutFormat.slice(0, byIdx).trim() : withoutFormat
    const author = byIdx !== -1 ? withoutFormat.slice(byIdx + 4).trim() : ''

    // If title is suspiciously short and the comment looks like a real title, use it instead
    if (title.split(/\s+/).length <= 1 && item.comment && item.comment.length > title.length) {
      title = item.comment.trim()
    }

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

// ── Goodreads CSV import ─────────────────────────────────────────────────────

app.post('/api/books/import-goodreads', express.text({ type: 'text/csv', limit: '10mb' }), (req, res) => {
  const csv = req.body as string
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'No CSV data' })

  // Simple CSV parser (handles quoted fields with commas)
  const lines = csv.split('\n')
  const headers = parseCsvLine(lines[0])
  const col = (row: string[], name: string) => {
    const idx = headers.indexOf(name)
    return idx >= 0 ? row[idx]?.trim() : ''
  }

  const books = readBooks()
  const existingTitles = new Set(books.map(b => b.title.toLowerCase().trim()))
  let added = 0
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const row = parseCsvLine(lines[i])

    const shelf = col(row, 'Exclusive Shelf')
    // Only import to-read books
    if (shelf !== 'to-read') { skipped++; continue }

    const title = col(row, 'Title').replace(/\s*\(.*?#\d+\)\s*$/, '').trim() // strip series info like "(Series, #1)"
    if (!title || existingTitles.has(title.toLowerCase())) { skipped++; continue }

    const author = col(row, 'Author')
    const isbn10 = col(row, 'ISBN').replace(/[="]/g, '').trim()
    const isbn13 = col(row, 'ISBN13').replace(/[="]/g, '').trim()
    const pages = parseInt(col(row, 'Number of Pages')) || undefined
    const dateAdded = col(row, 'Date Added')

    let addedAt: string
    try {
      const d = new Date(dateAdded)
      addedAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
    } catch { addedAt = new Date().toISOString() }

    const primaryIsbn = isbn13 || isbn10
    const isbns = [isbn13, isbn10].filter(Boolean)

    const book: WishlistBook = {
      id: Date.now().toString() + added,
      title,
      author,
      isbn: primaryIsbn || undefined,
      isbns,
      pages,
      addedAt,
      prices: [],
    }

    books.push(book)
    existingTitles.add(title.toLowerCase())
    added++
  }

  writeBooks(books)
  res.json({ added, skipped })
})

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// ── Bulk metadata enrichment ─────────────────────────────────────────────────

interface EnrichState {
  running: boolean
  current: number
  total: number
  currentTitle: string
}

const enrichState: EnrichState = { running: false, current: 0, total: 0, currentTitle: '' }
let enrichAborted = false

app.get('/api/enrich/status', (_req, res) => { res.json(enrichState) })

app.post('/api/enrich/stop', (_req, res) => {
  if (!enrichState.running) return res.json({ ok: false, message: 'Not running' })
  enrichAborted = true
  res.json({ ok: true })
})

app.post('/api/enrich', (_req, res) => {
  if (enrichState.running) return res.status(409).json({ error: 'Already running' })

  const books = readBooks()
  // Books that need enrichment: missing cover or have ≤1 ISBN
  const toEnrich = books.filter(b => !b.coverUrl || b.isbns.length <= 1)

  if (toEnrich.length === 0) return res.json({ started: false, message: 'All books already have metadata.' })

  enrichState.running = true
  enrichState.current = 0
  enrichState.total = toEnrich.length
  enrichState.currentTitle = toEnrich[0]?.title ?? ''
  enrichAborted = false

  res.json({ started: true, total: toEnrich.length })

  ;(async () => {
    try {
      for (let i = 0; i < toEnrich.length; i++) {
        if (enrichAborted) { console.log('Enrichment stopped by user.'); break }
        enrichState.current = i
        enrichState.currentTitle = toEnrich[i].title

        const book = toEnrich[i]
        const isbn = book.isbn || book.isbns[0] || ''
        const query = encodeURIComponent(`${book.title} ${book.author}`.trim())

        let coverUrl = book.coverUrl
        let pages = book.pages
        let isbns = book.isbns
        let workKey: string | undefined

        // Try Open Library by ISBN first
        if (isbn) {
          try {
            const r = await fetch(`https://openlibrary.org/isbn/${isbn.replace(/[-\s]/g, '')}.json`)
            if (r.ok) {
              const data = await r.json()
              if (!coverUrl && data.covers?.[0]) coverUrl = `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg`
              if (!pages && data.number_of_pages) pages = data.number_of_pages
              workKey = data.works?.[0]?.key
            }
          } catch {}
        }

        // Fallback: Open Library search
        if (!coverUrl || !workKey) {
          try {
            const r = await fetch(`https://openlibrary.org/search.json?q=${query}&limit=1&fields=cover_i,number_of_pages_median,key`)
            if (r.ok) {
              const data = await r.json()
              const doc = data.docs?.[0]
              if (doc) {
                if (!coverUrl && doc.cover_i) coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
                if (!pages && doc.number_of_pages_median) pages = doc.number_of_pages_median
                if (!workKey) workKey = doc.key
              }
            }
          } catch {}
        }

        // Fallback: Google Books
        if (!coverUrl) {
          try {
            const gq = isbn ? `isbn:${isbn}` : query
            const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gq)}&maxResults=1`)
            if (r.ok) {
              const data = await r.json()
              const vol = data.items?.[0]?.volumeInfo
              if (vol?.imageLinks?.thumbnail) coverUrl = vol.imageLinks.thumbnail.replace('http://', 'https://')
              if (!pages && vol?.pageCount) pages = vol.pageCount
            }
          } catch {}
        }

        // Fetch all edition ISBNs
        if (workKey && isbns.length <= 1) {
          try {
            const r = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=100`)
            if (r.ok) {
              const data = await r.json()
              const all: string[] = []
              for (const entry of data.entries || []) {
                if (entry.isbn_13) all.push(...entry.isbn_13)
                if (entry.isbn_10) all.push(...entry.isbn_10)
              }
              if (all.length > 0) isbns = [...new Set(all)]
            }
          } catch {}
        }

        // Persist
        const fresh = readBooks()
        const idx = fresh.findIndex(b => b.id === book.id)
        if (idx !== -1) {
          if (coverUrl) fresh[idx].coverUrl = coverUrl
          if (pages) fresh[idx].pages = pages
          if (isbns.length > fresh[idx].isbns.length) fresh[idx].isbns = isbns
          if (isbns[0] && !fresh[idx].isbn) fresh[idx].isbn = isbns[0]
          writeBooks(fresh)
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 300))
      }
    } catch (e) {
      log('error', 'enrich', 'Bulk enrichment failed', (e as Error).message)
    } finally {
      enrichState.running = false
      enrichState.current = enrichState.total
      enrichState.currentTitle = ''
    }
  })()
})

// ── ISBN cleanup (re-filter editions by language/format) ─────────────────────

interface CleanupState { running: boolean; current: number; total: number; currentTitle: string; removed: number }
const cleanupState: CleanupState = { running: false, current: 0, total: 0, currentTitle: '', removed: 0 }
let cleanupAborted = false

app.get('/api/cleanup-isbns/status', (_req, res) => { res.json(cleanupState) })

app.post('/api/cleanup-isbns/stop', (_req, res) => {
  if (!cleanupState.running) return res.json({ ok: false })
  cleanupAborted = true
  res.json({ ok: true })
})

app.post('/api/cleanup-isbns', (_req, res) => {
  if (cleanupState.running) return res.status(409).json({ error: 'Already running' })

  const books = readBooks()
  const toClean = books.filter(b => b.isbns.length > 1 && (b.isbn || b.asin))

  if (toClean.length === 0) return res.json({ started: false, message: 'No books need cleanup.' })

  cleanupState.running = true
  cleanupState.current = 0
  cleanupState.total = toClean.length
  cleanupState.currentTitle = toClean[0]?.title ?? ''
  cleanupState.removed = 0
  cleanupAborted = false

  res.json({ started: true, total: toClean.length })

  const AUDIO_RE = /audio|cd|mp3|cassette|spoken/i

  ;(async () => {
    try {
      for (let i = 0; i < toClean.length; i++) {
        if (cleanupAborted) break
        const book = toClean[i]
        cleanupState.current = i
        cleanupState.currentTitle = book.title

        const primaryIsbn = (book.isbn || book.asin || '').replace(/[-\s]/g, '')
        if (!primaryIsbn) continue

        try {
          // Get language of primary edition
          const isbnRes = await fetch(`https://openlibrary.org/isbn/${primaryIsbn}.json`)
          if (!isbnRes.ok) continue
          const isbnData = await isbnRes.json()
          const lang = isbnData.languages?.[0]?.key?.replace('/languages/', '')
          const workKey = isbnData.works?.[0]?.key
          if (!workKey) continue

          // Fetch all editions with metadata
          const edRes = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=100`)
          if (!edRes.ok) continue
          const edData = await edRes.json()

          const goodIsbns = new Set<string>()
          for (const entry of edData.entries || []) {
            const edLang = entry.languages?.[0]?.key?.replace('/languages/', '')
            const format = entry.physical_format || ''

            // Skip audiobooks
            if (AUDIO_RE.test(format)) continue
            // Skip wrong language (if we know both)
            if (lang && edLang && edLang !== lang) continue

            for (const isbn of [...(entry.isbn_13 || []), ...(entry.isbn_10 || [])]) {
              goodIsbns.add(isbn)
            }
          }

          // Always keep the primary ISBN
          goodIsbns.add(primaryIsbn)

          const before = book.isbns.length
          const filtered = book.isbns.filter(i => goodIsbns.has(i))
          // Only update if we actually removed something
          if (filtered.length < before) {
            const fresh = readBooks()
            const idx = fresh.findIndex(b => b.id === book.id)
            if (idx !== -1) {
              fresh[idx].isbns = filtered.length > 0 ? filtered : [primaryIsbn]
              writeBooks(fresh)
              cleanupState.removed += before - filtered.length
            }
          }
        } catch (e) {
          log('warn', 'cleanup', `Failed to clean ISBNs for "${book.title}"`, (e as Error).message)
        }

        await new Promise(r => setTimeout(r, 300))
      }
    } finally {
      cleanupState.running = false
      cleanupState.current = cleanupState.total
      cleanupState.currentTitle = ''
      console.log(`ISBN cleanup done: removed ${cleanupState.removed} ISBNs`)
    }
  })()
})

// ── Logs ─────────────────────────────────────────────────────────────────────

app.get('/api/logs', (_req, res) => {
  res.json(getLogs())
})

app.delete('/api/logs', (_req, res) => {
  clearLogs()
  res.json({ ok: true })
})

// ── Production frontend ──────────────────────────────────────────────────────

const CLIENT_DIST = resolve(__dirname, '../../client/dist')
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST))
  app.get('*', (_req, res) => {
    res.sendFile(resolve(CLIENT_DIST, 'index.html'))
  })
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Book wishlist server running at http://${HOST}:${PORT}`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
