/**
 * Scrapes isbns.net prices for all books in wishlist.json that have ISBNs.
 * Usage: tsx scripts/scrape-all-prices.ts [--force] [--limit N]
 *
 * --force   Re-scrape books that already have price data
 * --limit N Only scrape the first N books (useful for testing)
 *
 * For each book, tries ISBNs one by one until it finds sellers, then stops.
 * Results are saved progressively so you can Ctrl+C and resume later.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = resolve(__dirname, '../data/wishlist.json')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Seller { name: string; price: number; currency: string; condition?: string; location?: string; url: string }
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
        if (href) out.push({ name, price, currency: m[1], condition, location, url: href })
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
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : Infinity

  const books = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as WishlistBook[]

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

    // Update this book in the array and save progressively
    const idx = books.findIndex(b => b.id === book.id)
    if (idx !== -1) {
      books[idx].prices = prices
      books[idx].pricesLastChecked = new Date().toISOString()
    }
    writeFileSync(DATA_PATH, JSON.stringify(books, null, 2))

    if (i < toScrape.length - 1) await sleep(800)
  }

  if (browser) await browser.close()
  console.log(`\nDone! ${found}/${toScrape.length} books have price data.`)
  if (found < toScrape.length) {
    console.log(`Tip: run with --force to retry books with no offers, or check /api/debug-scrape/:isbn`)
    console.log(`     to inspect isbns.net HTML and tune selectors in server/src/scraper.ts`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
