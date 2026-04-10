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
  // If has both dot and comma: dot is thousand sep, comma is decimal (e.g., "1.911,50")
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  }
  // If has dot followed by exactly 3 digits (and nothing after): thousand sep (e.g., "1.911")
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  // If has comma: it's a decimal separator (e.g., "12,95")
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

// ── Source: AbeBooks (iberlibro.com — EUR) ────────────────────────────────────

async function scrapeAbebooks(isbn: string, page: Page): Promise<Seller[]> {
  const url = `https://www.iberlibro.com/servlet/SearchResults?isbn=${isbn}&sts=t&sortby=2`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForSelector('li[data-test-id="listing-item"]', { timeout: 8_000 }).catch(() => {})
    return await page.evaluate(() => {
      const out: Seller[] = []
      document.querySelectorAll('li[data-test-id="listing-item"]').forEach(li => {
        const priceText = li.querySelector('p.item-price')?.textContent?.trim() ?? ''
        const m = priceText.match(/([A-Z]{3})\s*([\d.,]+)/)
        if (!m) return
        let raw = m[2]
        if (raw.includes('.') && raw.includes(',')) { raw = raw.replace(/\./g, '').replace(',', '.') }
        else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) { raw = raw.replace(/\./g, '') }
        else if (raw.includes(',')) { raw = raw.replace(',', '.') }
        const price = parseFloat(raw)
        if (isNaN(price) || price <= 0) return
        const spans = li.querySelectorAll('.bookseller-info span')
        const name = spans[0]?.textContent?.trim() || 'Unknown'
        const location = spans[1]?.textContent?.trim()
        const condition = li.querySelector('.opt-subcondition')?.textContent?.trim()
        // Direct listing link: /BookTitle/ID/bd
        const detailLink = li.querySelector('a[href$="/bd"]') as HTMLAnchorElement | null
        const href = detailLink?.href || ''
        if (href) out.push({ name, price, currency: m[1], condition, location, url: href, source: 'abebooks' })
      })
      return out
    }) as Seller[]
  } catch { return [] }
}

// ── Source: Amazon (configurable domain) ─────────────────────────────────────

async function scrapeAmazon(isbn: string, page: Page, opts: ScrapeOptions): Promise<Seller[]> {
  const domain = opts.amazonDomain
  const url = `https://www.${domain}/s?k=${isbn}&i=stripbooks`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 8_000 }).catch(() => {})
    return await page.evaluate(({ domain, currency }) => {
      const out: { name: string; price: number; currency: string; condition?: string; url: string; source: string }[] = []
      document.querySelectorAll('[data-component-type="s-search-result"]').forEach(card => {
        const cardText = card.textContent?.toLowerCase() ?? ''
        // Skip Kindle, ebook, audiobook, and audible results
        if (/kindle|ebook|e-book|audible|audiobook|audio cd|formato digital/.test(cardText)) {
          // Check if it also has a physical format — if not, skip entirely
          if (!/paperback|hardcover|tapa blanda|tapa dura|pasta blanda/.test(cardText)) return
        }
        // Skip links to Kindle ASINs (dp/B...)
        const linkEl = card.querySelector('a.a-link-normal[href*="/dp/"]') as HTMLAnchorElement | null
        const rawHref = linkEl?.getAttribute('href') ?? ''
        if (/\/dp\/B[A-Z0-9]{9}/.test(rawHref)) return

        const wholeEl = card.querySelector('.a-price .a-price-whole')
        const fracEl = card.querySelector('.a-price .a-price-fraction')
        if (!wholeEl) return
        const whole = wholeEl.textContent?.replace(/[.,\s]/g, '') ?? '0'
        const frac = fracEl?.textContent?.trim() ?? '00'
        const price = parseFloat(`${whole}.${frac}`)
        if (isNaN(price) || price <= 0) return
        const href = linkEl ? `https://www.${domain}${rawHref}` : ''
        out.push({ name: domain, price, currency, condition: 'New', url: href, source: 'amazon' })
      })
      return out.slice(0, 5)
    }, { domain, currency: opts.currency }) as Seller[]
  } catch { return [] }
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
  const pages = await Promise.all([b.newPage(), b.newPage(), b.newPage()])

  try {
    const [abeSellers, amzSellers, bfSellers] = await Promise.all([
      scrapeAbebooks(isbn, pages[0]),
      scrapeAmazon(isbn, pages[1], opts),
      scrapeBookFinder(isbn, pages[2], opts),
    ])
    const all = [...abeSellers, ...amzSellers, ...bfSellers]
    return all.sort((a, b) => a.price - b.price)
  } catch (e) {
    // Error logged by caller
    return []
  } finally {
    await Promise.all(pages.map(p => p.close()))
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
