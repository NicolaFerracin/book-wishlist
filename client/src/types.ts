export interface Seller {
  name: string
  price: number
  currency: string
  condition?: string
  location?: string
  url: string
  source?: string
}

export interface PriceResult {
  isbn: string
  sellers: Seller[]
  scrapedAt: string
}

export interface WishlistBook {
  id: string
  title: string
  author: string
  isbn?: string
  isbns: string[]
  coverUrl?: string
  notes?: string
  pages?: number
  addedAt: string
  prices: PriceResult[]
  pricesLastChecked?: string
  listName?: string
  asin?: string
}

export interface OpenLibraryResult {
  title: string
  author: string
  coverUrl?: string
  isbn?: string
  pages?: number
  firstPublishYear?: number
  workKey?: string
  source?: 'openlibrary' | 'googlebooks'
}
