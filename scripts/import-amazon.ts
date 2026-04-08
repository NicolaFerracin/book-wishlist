/**
 * One-off import script: parses Amazon wishlist JSON exports and populates wishlist.json.
 * Usage: tsx scripts/import-amazon.ts [file1.json file2.json ...]
 *
 * If no paths are given, looks for amazon-wishlist-*.json in ~/Downloads.
 * For each book, searches Open Library to fetch ISBNs across all editions.
 * Pass --skip-enrich to import without Open Library lookups (much faster).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { readdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Types ─────────────────────────────────────────────────────────────────────

interface WishlistBook {
  id: string
  title: string
  author: string
  isbn?: string
  isbns: string[]
  coverUrl?: string
  notes?: string
  pages?: number
  addedAt: string
  prices: []
  listName?: string   // which Amazon list it came from
  asin?: string
}

// ── Amazon JSON parsing ───────────────────────────────────────────────────────

interface AmazonItem {
  name: string
  price: string
  url: string
  imageUrl?: string
  dateAdded?: string
  comment?: string
}

interface AmazonExport {
  listName: string
  items: AmazonItem[]
}

function extractAsin(url: string): string | undefined {
  const m = url.match(/\/dp\/([A-Z0-9]{10})/)
  return m?.[1]
}

function splitNameAuthor(raw: string): { title: string; author: string } {
  // "Title by Author Name (Hardcover)" or "Title by Author (Paperback, 2023)"
  // Find last " by " that precedes an author + optional format
  const formatSuffix = /\s*\([^)]*(?:Hardcover|Paperback|Mass Market|Audio|Kindle|Board book|Spiral|CD|DVD|Blu)[^)]*\)\s*$/i
  const withoutFormat = raw.replace(formatSuffix, '').trim()

  // Split on " by " — use the last occurrence to handle titles like "Gone by the Wind by Author"
  const byIdx = withoutFormat.lastIndexOf(' by ')
  if (byIdx === -1) return { title: withoutFormat, author: '' }

  const title = withoutFormat.slice(0, byIdx).trim()
  const author = withoutFormat.slice(byIdx + 4).trim()
  return { title, author }
}

function parseJsonFile(filepath: string): { listName: string; books: { title: string; author: string; asin?: string; coverUrl?: string; dateAdded?: string; notes?: string }[] } {
  const raw = JSON.parse(readFileSync(filepath, 'utf-8')) as AmazonExport
  const books = raw.items.map((item) => {
    let { title, author } = splitNameAuthor(item.name)
    // If title is suspiciously short and comment looks like a real title, use it
    if (title.split(/\s+/).length <= 1 && item.comment && item.comment.length > title.length) {
      title = item.comment.trim()
    }
    return {
      title,
      author,
      asin: extractAsin(item.url),
      coverUrl: item.imageUrl || undefined,
      dateAdded: item.dateAdded,
      notes: item.comment?.trim() || undefined,
    }
  })
  return { listName: raw.listName, books }
}

// ── Open Library enrichment ───────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchAllIsbns(workKey: string): Promise<string[]> {
  try {
    const res = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=100`)
    if (!res.ok) return []
    const data = await res.json() as { entries?: { isbn_13?: string[]; isbn_10?: string[] }[] }
    const isbns: string[] = []
    for (const entry of data.entries ?? []) {
      if (entry.isbn_13) isbns.push(...entry.isbn_13)
      if (entry.isbn_10) isbns.push(...entry.isbn_10)
    }
    return [...new Set(isbns)]
  } catch {
    return []
  }
}

async function enrichViaIsbn(isbn: string): Promise<{ isbn?: string; isbns: string[]; pages?: number; coverUrl?: string } | null> {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`)
    if (!res.ok) return null
    const data = await res.json() as { covers?: number[]; number_of_pages?: number; works?: { key: string }[] }
    const coverId = data.covers?.[0]
    const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined
    const workKey = data.works?.[0]?.key
    let isbns: string[] = [isbn]
    if (workKey) {
      const allIsbns = await fetchAllIsbns(workKey)
      if (allIsbns.length > 0) isbns = allIsbns
    }
    return { isbn, isbns, pages: data.number_of_pages, coverUrl }
  } catch {
    return null
  }
}

async function enrichFromOpenLibrary(title: string, author: string, asin?: string): Promise<{ isbn?: string; isbns: string[]; pages?: number; coverUrl?: string }> {
  // If ASIN is numeric it's an ISBN-10 — try it directly first (more accurate than title search)
  if (asin && /^\d{10}$/.test(asin)) {
    const result = await enrichViaIsbn(asin)
    if (result && result.isbns.length > 0) return result
    // If Open Library didn't find it, at least we know the ISBN
    if (result) return { ...result, isbn: asin, isbns: [asin] }
  }

  // Fall back to title search
  try {
    const query = encodeURIComponent(`${title} ${author}`.trim())
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${query}&limit=1&fields=cover_i,isbn,number_of_pages_median,key`
    )
    if (!res.ok) return asin ? { isbn: asin, isbns: [asin] } : { isbns: [] }
    const data = await res.json() as {
      docs?: { cover_i?: number; isbn?: string[]; number_of_pages_median?: number; key?: string }[]
    }
    const doc = data.docs?.[0]
    if (!doc) return asin ? { isbn: asin, isbns: [asin] } : { isbns: [] }

    const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined
    let isbns: string[] = doc.isbn?.slice(0, 20) ?? []

    if (doc.key) {
      const allIsbns = await fetchAllIsbns(doc.key)
      if (allIsbns.length > 0) isbns = allIsbns
    }

    // If title search also found nothing and we have an ASIN, use it as fallback
    if (isbns.length === 0 && asin && /^\d{10}$/.test(asin)) {
      isbns = [asin]
    }

    return { isbn: isbns[0], isbns, pages: doc.number_of_pages_median, coverUrl }
  } catch {
    return asin && /^\d{10}$/.test(asin) ? { isbn: asin, isbns: [asin] } : { isbns: [] }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const skipEnrich = process.argv.includes('--skip-enrich')

  let jsonFiles: string[]
  if (args.length > 0) {
    jsonFiles = args
  } else {
    const dl = homedir() + '/Downloads'
    jsonFiles = readdirSync(dl)
      .filter((f) => f.startsWith('amazon-wishlist-') && f.endsWith('.json'))
      .map((f) => `${dl}/${f}`)
  }

  if (jsonFiles.length === 0) {
    console.error('No amazon-wishlist-*.json files found in ~/Downloads. Pass file paths as arguments.')
    process.exit(1)
  }

  console.log(`Parsing ${jsonFiles.length} file(s)...`)

  const rawBooks: { title: string; author: string; asin?: string; coverUrl?: string; dateAdded?: string; notes?: string; listName: string }[] = []
  const seenTitles = new Set<string>()

  for (const file of jsonFiles) {
    const { listName, books } = parseJsonFile(file)
    let added = 0
    for (const b of books) {
      const key = b.title.toLowerCase().trim()
      if (!seenTitles.has(key)) {
        seenTitles.add(key)
        rawBooks.push({ ...b, listName })
        added++
      }
    }
    console.log(`  [${listName}] ${added} books`)
  }

  console.log(`\nTotal unique books: ${rawBooks.length}`)

  if (skipEnrich) {
    console.log('Skipping Open Library enrichment (--skip-enrich)')
  } else {
    console.log('Enriching with Open Library (this will take a few minutes)...\n')
  }

  const wishlistBooks: WishlistBook[] = []
  for (let i = 0; i < rawBooks.length; i++) {
    const raw = rawBooks[i]
    process.stdout.write(`[${i + 1}/${rawBooks.length}] ${raw.title.slice(0, 55).padEnd(55)}`)

    let isbn: string | undefined
    let isbns: string[] = []
    let pages: number | undefined
    let coverUrl = raw.coverUrl

    if (!skipEnrich) {
      const enriched = await enrichFromOpenLibrary(raw.title, raw.author, raw.asin)
      isbn = enriched.isbn
      isbns = enriched.isbns
      pages = enriched.pages
      coverUrl = enriched.coverUrl ?? coverUrl
      process.stdout.write(` ✓ (${isbns.length} ISBNs)\n`)
      if (i < rawBooks.length - 1) await sleep(300)
    } else {
      process.stdout.write('\n')
    }

    wishlistBooks.push({
      id: Date.now().toString() + i,
      title: raw.title,
      author: raw.author,
      isbn,
      isbns,
      coverUrl,
      pages,
      notes: raw.notes,
      addedAt: (() => { try { const d = new Date(raw.dateAdded ?? ''); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString() } catch { return new Date().toISOString() } })(),
      prices: [],
      listName: raw.listName,
      asin: raw.asin,
    })
  }

  const outPath = resolve(__dirname, '../data/wishlist.json')
  writeFileSync(outPath, JSON.stringify(wishlistBooks, null, 2))
  console.log(`\nDone! ${wishlistBooks.length} books saved to ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
