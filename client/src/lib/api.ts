import type { WishlistBook } from '../types'

export async function getBooks(): Promise<WishlistBook[]> {
  const res = await fetch('/api/books')
  return res.json()
}

export async function addBook(book: Omit<WishlistBook, 'id' | 'addedAt' | 'prices'>): Promise<WishlistBook> {
  const res = await fetch('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(book),
  })
  return res.json()
}

export async function updateBook(id: string, updates: Partial<WishlistBook>): Promise<WishlistBook> {
  const res = await fetch(`/api/books/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return res.json()
}

export async function deleteBook(id: string): Promise<void> {
  await fetch(`/api/books/${id}`, { method: 'DELETE' })
}
