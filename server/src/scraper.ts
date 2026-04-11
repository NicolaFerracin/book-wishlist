import { chromium, type Browser, type Page } from 'playwright'
import type { Seller, PriceResult } from './types.js'
import { parsePrice } from './parsePrice.js'

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

export interface ScrapeOptions {
  amazonDomain: string
  currency: string
  country: string
}

const DEFAULT_OPTIONS: ScrapeOptions = {
  amazonDomain: 'amazon.es',
  currency: 'EUR',
  country: 'pt',
}

function isExcludedDomain(url: string, opts: ScrapeOptions): boolean {
  if (url.includes('amazon.')) {
    return !url.includes(opts.amazonDomain)
  }
  return false
}

// ── Source: BookFinder (aggregator) ───────────────────────────────────────────

async function scrapeBookFinder(isbn: string, page: Page, opts: ScrapeOptions): Promise<Seller[]> {
  const cleanIsbn = isbn.replace(/[-\s]/g, '')
  const url = `https://www.bookfinder.com/isbn/${cleanIsbn}/?currency=${opts.currency}&destination=${opts.country}&mode=basic&st=sh&ac=qr`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await new Promise(r => setTimeout(r, 2500))

    // Extract raw text from the page — parsing happens server-side with parsePrice
    const rawResults = await page.evaluate(() => {
      const results: { priceText: string; shippingText?: string; seller: string; condition?: string; url: string }[] = []
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || ''
        const text = a.textContent?.trim() || ''
        const m = text.match(/^€([\d.,]+)$/)
        if (!m || href.includes('bookfinder.com')) return

        // Walk up to find row
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

        // Resolve affiliate URLs
        let resolvedHref = href
        if (href.includes('affiliates.abebooks.com')) {
          try {
            const uParam = new URL(href).searchParams.get('u')
            if (uParam) resolvedHref = uParam.startsWith('http') ? uParam : `https://${uParam}`
          } catch {}
        }
        // ShopBasket → BookDetailsPL
        const basketMatch = resolvedHref.match(/\/servlet\/ShopBasket.*?[?&]ik=(\d+)/)
        if (basketMatch) {
          const domain = resolvedHref.includes('zvab.com') ? 'www.iberlibro.com' : (() => { try { return new URL(resolvedHref).hostname } catch { return 'www.iberlibro.com' } })()
          resolvedHref = `https://${domain}/servlet/BookDetailsPL?bi=${basketMatch[1]}`
        }
        resolvedHref = resolvedHref.replace(/zvab\.com/g, 'iberlibro.com')

        results.push({
          priceText: m[1],
          shippingText: shipMatch?.[1],
          seller: seller || 'BookFinder',
          condition,
          url: resolvedHref,
        })
      })
      // Deduplicate by URL
      const seen = new Set<string>()
      return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
    })

    // Parse prices server-side with the proper parser
    const sellers: Seller[] = rawResults.map(r => {
      const price = parsePrice(r.priceText)
      const shipping = r.shippingText ? parsePrice(r.shippingText) : undefined
      const totalPrice = shipping !== undefined ? price + shipping : price
      return {
        name: r.seller,
        price,
        shipping,
        totalPrice,
        currency: 'EUR',
        condition: r.condition,
        url: r.url,
        source: 'bookfinder' as const,
      }
    }).filter(s => !isNaN(s.price) && s.price > 0)

    return sellers
      .filter(s => !isExcludedDomain(s.url, opts))
      .sort((a, b) => (a.totalPrice ?? a.price) - (b.totalPrice ?? b.price))
  } catch { return [] }
}

// ── Scrape one ISBN ──────────────────────────────────────────────────────────

async function scrapeIsbn(isbn: string, opts: ScrapeOptions = DEFAULT_OPTIONS): Promise<Seller[]> {
  const b = await getBrowser()
  const page = await b.newPage()
  try {
    return await scrapeBookFinder(isbn, page, opts)
  } catch (e) {
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
  const primary = [book.isbn, book.asin].filter(Boolean) as string[]
  const others = book.isbns.filter(i => !primary.includes(i))
  const candidates = [...new Set([...primary, ...others])]
  if (candidates.length === 0) return []

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
