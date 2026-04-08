import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WishlistBook } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = resolve(__dirname, '../../data/wishlist.json')

export function readBooks(): WishlistBook[] {
  if (!existsSync(DATA_PATH)) {
    mkdirSync(dirname(DATA_PATH), { recursive: true })
    writeFileSync(DATA_PATH, '[]')
    return []
  }
  return JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as WishlistBook[]
}

export function writeBooks(books: WishlistBook[]): void {
  writeFileSync(DATA_PATH, JSON.stringify(books, null, 2))
}
