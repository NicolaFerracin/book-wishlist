import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { PriceResult, WishlistBook } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '../../data')
const DB_PATH = resolve(DATA_DIR, 'book-wishlist.sqlite')
const LEGACY_WISHLIST_PATH = resolve(DATA_DIR, 'wishlist.json')

mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    isbn TEXT,
    isbns_json TEXT NOT NULL DEFAULT '[]',
    cover_url TEXT,
    notes TEXT,
    pages INTEGER,
    added_at TEXT NOT NULL,
    prices_json TEXT NOT NULL DEFAULT '[]',
    prices_last_checked TEXT,
    list_name TEXT,
    asin TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_books_added_at ON books(added_at);
`)

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

interface BookRow {
  id: string
  title: string
  author: string
  isbn: string | null
  isbns_json: string
  cover_url: string | null
  notes: string | null
  pages: number | null
  added_at: string
  prices_json: string
  prices_last_checked: string | null
  list_name: string | null
  asin: string | null
}

function rowToBook(row: BookRow): WishlistBook {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn ?? undefined,
    isbns: parseJson<string[]>(row.isbns_json, []),
    coverUrl: row.cover_url ?? undefined,
    notes: row.notes ?? undefined,
    pages: row.pages ?? undefined,
    addedAt: row.added_at,
    prices: parseJson<PriceResult[]>(row.prices_json, []),
    pricesLastChecked: row.prices_last_checked ?? undefined,
    listName: row.list_name ?? undefined,
    asin: row.asin ?? undefined,
  }
}

const selectBooks = db.prepare('SELECT * FROM books ORDER BY added_at DESC')

const upsertBook = db.prepare(`
  INSERT INTO books (
    id, title, author, isbn, isbns_json, cover_url, notes, pages, added_at,
    prices_json, prices_last_checked, list_name, asin
  ) VALUES (
    @id, @title, @author, @isbn, @isbns_json, @cover_url, @notes, @pages, @added_at,
    @prices_json, @prices_last_checked, @list_name, @asin
  )
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    author = excluded.author,
    isbn = excluded.isbn,
    isbns_json = excluded.isbns_json,
    cover_url = excluded.cover_url,
    notes = excluded.notes,
    pages = excluded.pages,
    added_at = excluded.added_at,
    prices_json = excluded.prices_json,
    prices_last_checked = excluded.prices_last_checked,
    list_name = excluded.list_name,
    asin = excluded.asin
`)

const replaceBooksTx = db.transaction((books: WishlistBook[]) => {
  db.prepare('DELETE FROM books').run()
  for (const book of books) writeBook(book)
})

function writeBook(book: WishlistBook): void {
  upsertBook.run({
    id: book.id,
    title: book.title,
    author: book.author ?? '',
    isbn: book.isbn ?? null,
    isbns_json: JSON.stringify(book.isbns ?? []),
    cover_url: book.coverUrl ?? null,
    notes: book.notes ?? null,
    pages: book.pages ?? null,
    added_at: book.addedAt,
    prices_json: JSON.stringify(book.prices ?? []),
    prices_last_checked: book.pricesLastChecked ?? null,
    list_name: book.listName ?? null,
    asin: book.asin ?? null,
  })
}

export function readBooks(): WishlistBook[] {
  return (selectBooks.all() as BookRow[]).map(rowToBook)
}

export function writeBooks(books: WishlistBook[]): void {
  replaceBooks(books)
}

export function replaceBooks(books: WishlistBook[]): void {
  replaceBooksTx(books)
}

export function clearAllPrices(): number {
  const result = db.prepare(`
    UPDATE books
    SET prices_json = '[]', prices_last_checked = NULL
    WHERE prices_last_checked IS NOT NULL OR prices_json != '[]'
  `).run()
  return result.changes
}

const bookCount = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
if (bookCount.count === 0 && existsSync(LEGACY_WISHLIST_PATH)) {
  try {
    const books = JSON.parse(readFileSync(LEGACY_WISHLIST_PATH, 'utf-8')) as WishlistBook[]
    replaceBooks(books)
    console.log(`Migrated ${books.length} books from data/wishlist.json to data/book-wishlist.sqlite`)
  } catch (e) {
    console.error(`Failed to migrate data/wishlist.json: ${(e as Error).message}`)
  }
}
