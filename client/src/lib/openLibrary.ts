import type { OpenLibraryResult } from '../types'

// ── Open Library ──────────────────────────────────────────────────────────────

async function searchOpenLibrary(queryStr: string): Promise<OpenLibraryResult[]> {
  const encoded = encodeURIComponent(queryStr)
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${encoded}&limit=5&fields=title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year,key`
  )
  const data = await res.json()
  return (data.docs || []).map((doc: Record<string, unknown>) => ({
    title: (doc.title as string) || '',
    author: ((doc.author_name as string[]) || [])[0] || '',
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : undefined,
    isbn: ((doc.isbn as string[]) || [])[0],
    pages: (doc.number_of_pages_median as number) || undefined,
    firstPublishYear: (doc.first_publish_year as number) || undefined,
    workKey: (doc.key as string) || undefined,
    source: 'openlibrary' as const,
  }))
}

async function lookupIsbnOpenLibrary(clean: string): Promise<OpenLibraryResult | null> {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${clean}.json`)
    if (!res.ok) return null
    const data = await res.json()
    let author = ''
    const authorKey = (data.authors as { key: string }[])?.[0]?.key
    if (authorKey) {
      const ar = await fetch(`https://openlibrary.org${authorKey}.json`)
      const ad = await ar.json()
      author = ad.name || ''
    }
    const coverId = (data.covers as number[])?.[0]
    const lang = (data.languages as { key: string }[])?.[0]?.key?.replace('/languages/', '') || undefined
    return {
      title: data.title || '',
      author,
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
      isbn: clean,
      pages: data.number_of_pages || undefined,
      workKey: (data.works as { key: string }[])?.[0]?.key || undefined,
      language: lang,
      source: 'openlibrary',
    }
  } catch {
    return null
  }
}

// ── Google Books ──────────────────────────────────────────────────────────────

async function searchGoogleBooks(queryStr: string): Promise<OpenLibraryResult[]> {
  try {
    const encoded = encodeURIComponent(queryStr)
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=5`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []).map((item: Record<string, unknown>) => {
      const vol = item.volumeInfo as Record<string, unknown>
      const ids = (vol.industryIdentifiers as { type: string; identifier: string }[]) || []
      const isbn13 = ids.find(i => i.type === 'ISBN_13')?.identifier
      const isbn10 = ids.find(i => i.type === 'ISBN_10')?.identifier
      const thumb = (vol.imageLinks as Record<string, string>)?.thumbnail
      return {
        title: (vol.title as string) || '',
        author: ((vol.authors as string[]) || [])[0] || '',
        coverUrl: thumb?.replace('http://', 'https://') || undefined,
        isbn: isbn13 || isbn10,
        pages: (vol.pageCount as number) || undefined,
        firstPublishYear: vol.publishedDate ? parseInt(vol.publishedDate as string) || undefined : undefined,
        source: 'googlebooks' as const,
      }
    })
  } catch {
    return []
  }
}

async function lookupIsbnGoogleBooks(clean: string): Promise<OpenLibraryResult | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`)
    if (!res.ok) return null
    const data = await res.json()
    const vol = data.items?.[0]?.volumeInfo
    if (!vol) return null
    const ids = (vol.industryIdentifiers as { type: string; identifier: string }[]) || []
    const isbn13 = ids.find((i: { type: string }) => i.type === 'ISBN_13')?.identifier
    const isbn10 = ids.find((i: { type: string }) => i.type === 'ISBN_10')?.identifier
    return {
      title: vol.title || '',
      author: vol.authors?.[0] || '',
      coverUrl: vol.imageLinks?.thumbnail?.replace('http://', 'https://') || undefined,
      isbn: isbn13 || isbn10 || clean,
      pages: vol.pageCount || undefined,
      firstPublishYear: vol.publishedDate ? parseInt(vol.publishedDate) || undefined : undefined,
      source: 'googlebooks',
    }
  } catch {
    return null
  }
}

// ── Combined search (both sources in parallel) ───────────────────────────────

export async function searchBooks(queryStr: string): Promise<OpenLibraryResult[]> {
  if (queryStr.length < 2) return []
  const [olResults, gbResults] = await Promise.all([
    searchOpenLibrary(queryStr).catch(() => [] as OpenLibraryResult[]),
    searchGoogleBooks(queryStr).catch(() => [] as OpenLibraryResult[]),
  ])

  // Merge: OL results first, then GB results that aren't duplicates
  const seen = new Set(olResults.map(r => r.title.toLowerCase()))
  const unique = [...olResults]
  for (const r of gbResults) {
    if (!seen.has(r.title.toLowerCase())) {
      seen.add(r.title.toLowerCase())
      unique.push(r)
    }
  }
  return unique.slice(0, 10)
}

// Combined ISBN lookup — tries both sources in parallel, returns first hit
export async function lookupByIsbn(isbn: string): Promise<OpenLibraryResult | null> {
  const clean = isbn.replace(/[-\s]/g, '')
  if (!/^\d{10}(\d{3})?$/.test(clean)) return null

  const [olResult, gbResult] = await Promise.all([
    lookupIsbnOpenLibrary(clean).catch(() => null),
    lookupIsbnGoogleBooks(clean).catch(() => null),
  ])

  // Prefer Open Library (has workKey for edition ISBNs), fall back to Google Books
  return olResult ?? gbResult
}

// ── Open Library editions ─────────────────────────────────────────────────────

export interface Edition {
  isbn: string
  language?: string   // e.g. "eng", "ita", "fre"
  format?: string     // e.g. "Paperback", "Hardcover", "Audio CD"
  publisher?: string
  year?: number
}

const AUDIO_FORMATS = /audio|cd|mp3|cassette|spoken/i

export async function fetchEditions(workKey: string): Promise<Edition[]> {
  try {
    const res = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=100`)
    if (!res.ok) return []
    const data = await res.json()
    const editions: Edition[] = []
    for (const entry of data.entries || []) {
      const lang = (entry.languages as { key: string }[])?.[0]?.key?.replace('/languages/', '') || undefined
      const format = entry.physical_format || undefined
      const publisher = (entry.publishers as string[])?.[0] || undefined
      const year = parseInt(entry.publish_date) || undefined
      const isbns: string[] = [
        ...((entry.isbn_13 as string[]) || []),
        ...((entry.isbn_10 as string[]) || []),
      ]
      for (const isbn of isbns) {
        editions.push({ isbn, language: lang, format, publisher, year })
      }
    }
    return editions
  } catch {
    return []
  }
}

// Fetch ISBNs with auto-filtering: exclude audiobooks, optionally filter by language
export async function fetchAllIsbns(workKey: string, preferredLanguage?: string): Promise<string[]> {
  const editions = await fetchEditions(workKey)
  const filtered = editions.filter(e => {
    // Exclude audiobooks
    if (e.format && AUDIO_FORMATS.test(e.format)) return false
    // Filter by language if specified
    if (preferredLanguage && e.language && e.language !== preferredLanguage) return false
    return true
  })
  return [...new Set(filtered.map(e => e.isbn))]
}
