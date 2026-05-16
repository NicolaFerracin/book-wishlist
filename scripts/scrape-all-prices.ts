/**
 * Scrapes prices for all books with ISBNs.
 * Usage: tsx scripts/scrape-all-prices.ts [--force] [--limit N] [--file path] [--api URL] [--clear-prices]
 *
 * --force   Re-scrape books that already have price data
 * --limit N Only scrape the first N books (useful for testing)
 * --file    Read/write a wishlist JSON file (defaults to data/wishlist.json)
 * --api     Read/write through a running Book Wishlist server API
 * --clear-prices Remove all saved price data and exit
 *
 * BOOK_WISHLIST_API can also be used instead of --api.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = resolve(__dirname, '../data/wishlist.json')

// ── Types ─────────────────────────────────────────────────────────────────────

interface Seller { name: string; price: number; currency: string; condition?: string; location?: string; url: string; source?: string }
interface PriceResult { isbn: string; sellers: Seller[]; scrapedAt: string }
interface WishlistBook {
  id: string; title: string; isbns: string[]; isbn?: string; asin?: string;
  prices: PriceResult[]; pricesLastChecked?: string;
  [key: string]: unknown
}

// ── Scraper ───────────────────────────────────────────────────────────────────

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// Reuse Playwright for all scraping (iberlibro.com = AbeBooks EUR)
import { chromium, type Browser } from 'playwright'
let browser: Browser | null = null
async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ headless: true })
  return browser
}

async function scrapeIsbn(isbn: string): Promise<Seller[]> {
  const url = `https://www.iberlibro.com/servlet/SearchResults?isbn=${isbn}&sts=t&sortby=2`
  const b = await getBrowser()
  const page = await b.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
    await sleep(800)
    const sellers = await page.evaluate(() => {
      const out: Seller[] = []
      document.querySelectorAll('li[data-test-id="listing-item"]').forEach(li => {
        const priceText = li.querySelector('p.item-price')?.textContent?.trim() ?? ''
        const m = priceText.match(/([A-Z]{3})\s*([\d.,]+)/)
        if (!m) return
        const price = parseFloat(m[2].replace(',', '.'))
        if (isNaN(price) || price <= 0) return
        const condition = li.querySelector('.opt-subcondition')?.textContent?.trim()
        const spans = li.querySelectorAll('.bookseller-info span')
        const name = spans[0]?.textContent?.trim() || 'Unknown'
        const location = spans[1]?.textContent?.trim()
        const href = (li.querySelector('a[href*="iberlibro"], a[href^="/"]') as HTMLAnchorElement | null)?.href || ''
        if (href) out.push({ name, price, currency: m[1], condition, location, url: href, source: 'iberlibro' })
      })
      return out
    }) as Seller[]
    return sellers.sort((a, b) => a.price - b.price)
  } catch { return [] }
  finally { await page.close() }
}

// Try ISBNs one by one until we find sellers, then stop.
// Caps at maxAttempts to avoid hammering isbns.net for books with 80+ editions.
async function scrapeBook(book: WishlistBook, maxAttempts = 5): Promise<PriceResult[]> {
  const candidates = [...new Set([
    book.isbn,
    book.asin,
    ...book.isbns,
  ].filter(Boolean))] as string[]

  if (candidates.length === 0) return []

  const results: PriceResult[] = []
  let found = false

  for (let i = 0; i < Math.min(candidates.length, maxAttempts); i++) {
    const isbn = candidates[i]
    const sellers = await scrapeIsbn(isbn)
    results.push({ isbn, sellers, scrapedAt: new Date().toISOString() })
    if (sellers.length > 0) { found = true; break }
    if (i < Math.min(candidates.length, maxAttempts) - 1) await sleep(700)
  }

  // If first pass found nothing, try a few more from later in the list
  if (!found && candidates.length > maxAttempts) {
    for (let i = maxAttempts; i < Math.min(candidates.length, maxAttempts + 3); i++) {
      const isbn = candidates[i]
      const sellers = await scrapeIsbn(isbn)
      results.push({ isbn, sellers, scrapedAt: new Date().toISOString() })
      if (sellers.length > 0) break
      await sleep(700)
    }
  }

  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force')
  const clearPrices = process.argv.includes('--clear-prices')
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : Infinity
  const fileArg = process.argv.indexOf('--file')
  const dataPath = fileArg !== -1 ? resolve(process.cwd(), process.argv[fileArg + 1]) : DEFAULT_DATA_PATH
  const apiArg = process.argv.indexOf('--api')
  const apiBase = (apiArg !== -1 ? process.argv[apiArg + 1] : process.env.BOOK_WISHLIST_API)?.replace(/\/$/, '')

  if (apiArg !== -1 && !process.argv[apiArg + 1]) throw new Error('--api requires a URL')
  if (fileArg !== -1 && !process.argv[fileArg + 1]) throw new Error('--file requires a path')

  const books = apiBase
    ? await fetchBooks(apiBase)
    : JSON.parse(readFileSync(dataPath, 'utf-8')) as WishlistBook[]

  if (clearPrices) {
    if (apiBase) {
      const cleared = await clearRemotePrices(apiBase)
      console.log(`Cleared saved prices for ${cleared} books.`)
      return
    }

    const withPrices = books.filter(b => b.pricesLastChecked || (b.prices?.length ?? 0) > 0)
    for (const book of withPrices) {
      book.prices = []
      delete book.pricesLastChecked
    }
    writeFileSync(dataPath, JSON.stringify(books, null, 2))
    console.log(`Cleared saved prices for ${withPrices.length} books.`)
    return
  }

  const toScrape = books.filter(b => {
    if ((b.isbns?.length ?? 0) === 0 && !b.isbn && !b.asin) return false
    if (!force && b.pricesLastChecked) return false
    return true
  }).slice(0, limit)

  const skipped = books.length - toScrape.length
  console.log(`Books to scrape: ${toScrape.length} (${skipped} skipped — already have prices or no ISBNs)`)
  if (toScrape.length === 0) { console.log('Nothing to do. Use --force to re-scrape.'); return }
  console.log('Scraping isbns.net (stopping per book as soon as sellers are found)...\n')

  let found = 0
  for (let i = 0; i < toScrape.length; i++) {
    const book = toScrape[i]
    process.stdout.write(`[${i + 1}/${toScrape.length}] ${book.title.slice(0, 55).padEnd(55)}`)

    const prices = await scrapeBook(book)
    const totalSellers = prices.reduce((s, p) => s + p.sellers.length, 0)
    const cheapest = prices.flatMap(p => p.sellers).sort((a, b) => a.price - b.price)[0]

    process.stdout.write(
      totalSellers > 0
        ? ` ✓ ${totalSellers} offers, from ${cheapest!.currency === 'GBP' ? '£' : cheapest!.currency === 'EUR' ? '€' : '$'}${cheapest!.price.toFixed(2)}\n`
        : ` — no offers found\n`
    )
    if (totalSellers > 0) found++

    // Update this book and save progressively, so Ctrl+C can resume later.
    const idx = books.findIndex(b => b.id === book.id)
    if (idx !== -1) {
      books[idx].prices = prices
      books[idx].pricesLastChecked = new Date().toISOString()
    }
    if (apiBase) {
      await updateBookPrices(apiBase, book.id, books[idx].prices, books[idx].pricesLastChecked)
    } else {
      writeFileSync(dataPath, JSON.stringify(books, null, 2))
    }

    if (i < toScrape.length - 1) await sleep(800)
  }

  if (browser) await browser.close()
  console.log(`\nDone! ${found}/${toScrape.length} books have price data.`)
  if (found < toScrape.length) {
    console.log(`Tip: run with --force to retry books with no offers.`)
    console.log(`     If scraping stops matching the site, tune selectors in scripts/scrape-all-prices.ts.`)
  }
}

async function fetchBooks(apiBase: string): Promise<WishlistBook[]> {
  const res = await fetch(`${apiBase}/api/books`)
  if (!res.ok) throw new Error(`Failed to fetch books from ${apiBase}: ${res.status} ${res.statusText}`)
  return await res.json() as WishlistBook[]
}

async function updateBookPrices(apiBase: string, id: string, prices: PriceResult[], pricesLastChecked?: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/books/${id}/prices`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices, pricesLastChecked }),
  })
  if (!res.ok) throw new Error(`Failed to update prices for ${id}: ${res.status} ${res.statusText}`)
}

async function clearRemotePrices(apiBase: string): Promise<number> {
  const res = await fetch(`${apiBase}/api/prices`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to clear prices: ${res.status} ${res.statusText}`)
  const data = await res.json() as { cleared: number }
  return data.cleared
}

main().catch(e => { console.error(e); process.exit(1) })
