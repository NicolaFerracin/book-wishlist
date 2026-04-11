import { chromium, type Browser, type Page } from 'playwright'
import type { Seller, PriceResult } from './types.js'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// Parse European-formatted price: "1.911,50" → 1911.5, "12,95" → 12.95, "3.00" → 3.0
function parseEurPrice(raw: string): number {
  let s = raw.trim()
  // Both dot and comma: dot is thousand sep, comma is decimal (e.g., "1.911,50")
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  }
  // Dot followed by exactly 3 digits: thousand sep (e.g., "1.911")
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  // Comma followed by exactly 3 digits: thousand sep (e.g., "1,050")
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    s = s.replace(/,/g, '')
  }
  // Comma as decimal separator (e.g., "12,95")
  else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  return parseFloat(s)
}

export interface ScrapeOptions {
  amazonDomain: string   // e.g. "amazon.es", "amazon.it", "amazon.de"
  currency: string       // e.g. "EUR", "GBP"
  country: string        // BookFinder destination: "pt", "it", "de", "gb"
}

const DEFAULT_OPTIONS: ScrapeOptions = {
  amazonDomain: 'amazon.es',
  currency: 'EUR',
  country: 'pt',
}

// ── Source: BookFinder (aggregator, configurable destination) ─────────────────

// Amazon domains to exclude — too far for reasonable shipping to Europe
function isExcludedDomain(url: string, opts: ScrapeOptions): boolean {
  // If it's an Amazon link, only allow the user's selected domain
  if (url.includes('amazon.')) {
    return !url.includes(opts.amazonDomain)
  }
  return false
}

async function scrapeBookFinder(isbn: string, page: Page, opts: ScrapeOptions): Promise<Seller[]> {
  const url = `https://www.bookfinder.com/isbn/${isbn}/?currency=${opts.currency}&destination=${opts.country}&mode=basic&st=sh&ac=qr`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await new Promise(r => setTimeout(r, 2500))
    return await page.evaluate(() => {
      const results: Seller[] = []
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || ''
        const text = a.textContent?.trim() || ''
        const m = text.match(/^€([\d.,]+)$/)
        if (!m || href.includes('bookfinder.com')) return
        let raw = m[1]
        if (raw.includes('.') && raw.includes(',')) { raw = raw.replace(/\./g, '').replace(',', '.') }
        else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) { raw = raw.replace(/\./g, '') }
        else if (/^\d{1,3}(,\d{3})+$/.test(raw)) { raw = raw.replace(/,/g, '') }
        else if (raw.includes(',')) { raw = raw.replace(',', '.') }
        const price = parseFloat(raw)
        if (isNaN(price) || price <= 0) return

        // Walk up to find row and extract metadata
        let row = a.parentElement
        for (let i = 0; i < 5 && row; i++) {
          if (row.children.length > 3) break
          row = row.parentElement
        }
        const rowText = row?.textContent || ''
        const fromMatch = rowText.match(/From:\s*([^\n€]+)/i)
        let seller = fromMatch?.[1]?.trim() || ''
        if (!seller) try { seller = new URL(href).hostname.replace('www.', '') } catch {}
        const condMatch = rowText.match(/Condition:\s*([^\n€]+)/i) || rowText.match(/(Used\s*-\s*[\w ]+|New|Like New)/i)
        const condition = condMatch?.[1]?.trim()
        const shipMatch = rowText.match(/shipping:\s*€([\d.,]+)/i)
        let shipVal: number | undefined
        if (shipMatch) {
          let sr = shipMatch[1]
          if (sr.includes('.') && sr.includes(',')) { sr = sr.replace(/\./g, '').replace(',', '.') }
          else if (/^\d{1,3}(\.\d{3})+$/.test(sr)) { sr = sr.replace(/\./g, '') }
          else if (/^\d{1,3}(,\d{3})+$/.test(sr)) { sr = sr.replace(/,/g, '') }
          else if (sr.includes(',')) { sr = sr.replace(',', '.') }
          shipVal = parseFloat(sr)
        }
        const shipping = shipVal
        const totalPrice = shipping !== undefined ? price + shipping : price
        // Clean up URLs
        let resolvedHref = href
        // Resolve affiliate redirects
        if (href.includes('affiliates.abebooks.com')) {
          try {
            const uParam = new URL(href).searchParams.get('u')
            if (uParam) resolvedHref = uParam.startsWith('http') ? uParam : `https://${uParam}`
          } catch {}
        }
        // ShopBasket (add-to-cart) → BookDetailsPL (view page)
        const basketMatch = resolvedHref.match(/\/servlet\/ShopBasket.*?[?&]ik=(\d+)/)
        if (basketMatch) {
          const domain = resolvedHref.includes('zvab.com') ? 'www.iberlibro.com' : new URL(resolvedHref).hostname
          resolvedHref = `https://${domain}/servlet/BookDetailsPL?bi=${basketMatch[1]}`
        }
        // Normalize zvab.com → iberlibro.com
        resolvedHref = resolvedHref.replace(/zvab\.com/g, 'iberlibro.com')
        results.push({ name: seller || 'BookFinder', price, shipping, totalPrice, currency: 'EUR', condition, url: resolvedHref, source: 'bookfinder' })
      })
      const seen = new Set<string>()
      return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
    }) as Seller[]
    return sellers.filter(s => !isExcludedDomain(s.url, opts))
  } catch { return [] }
}

// ── Scrape one ISBN across all sources in parallel ───────────────────────────

async function scrapeIsbn(isbn: string, opts: ScrapeOptions = DEFAULT_OPTIONS): Promise<Seller[]> {
  const b = await getBrowser()
  const page = await b.newPage()

  try {
    const all = await scrapeBookFinder(isbn, page, opts)
    return all.sort((a, b) => a.price - b.price)
  } catch (e) {
    // Error logged by caller
    return []
  } finally {
    await page.close()
  }
}

// ── Scrape a book across multiple ISBNs ──────────────────────────────────────

export async function scrapeBook(
  book: { isbn?: string; asin?: string; isbns: string[] },
  opts: ScrapeOptions = DEFAULT_OPTIONS,
  maxAttempts = 8,
  concurrency = 2,
): Promise<PriceResult[]> {
  // Prioritize the user's specific ISBN/ASIN first (the edition they actually want),
  // then try a few other edition ISBNs. This avoids checking unrelated language editions.
  const primary = [book.isbn, book.asin].filter(Boolean) as string[]
  const others = book.isbns.filter(i => !primary.includes(i))
  const candidates = [...new Set([...primary, ...others])]
  if (candidates.length === 0) return []

  // Check primary ISBNs + a limited number of others
  const toCheck = candidates.slice(0, maxAttempts)
  const results: PriceResult[] = []

  for (let i = 0; i < toCheck.length; i += concurrency) {
    const batch = toCheck.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (isbn) => {
        const sellers = await scrapeIsbn(isbn, opts)
        return { isbn, sellers, scrapedAt: new Date().toISOString() } as PriceResult
      })
    )
    results.push(...batchResults)
    if (i + concurrency < toCheck.length) await sleep(500)
  }

  return results
}

export async function scrapeAllIsbns(isbns: string[], opts: ScrapeOptions = DEFAULT_OPTIONS): Promise<PriceResult[]> {
  const results: PriceResult[] = []
  for (const isbn of isbns) {
    const sellers = await scrapeIsbn(isbn, opts)
    results.push({ isbn, sellers, scrapedAt: new Date().toISOString() })
    await sleep(600)
  }
  return results
}
