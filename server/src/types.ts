export interface Seller {
  name: string
  price: number
  shipping?: number   // shipping cost (same currency)
  totalPrice?: number // price + shipping
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
  isbn?: string        // primary ISBN (used for display / quick lookup)
  isbns: string[]      // all known ISBNs across editions
  coverUrl?: string
  notes?: string
  pages?: number
  addedAt: string      // ISO timestamp
  prices: PriceResult[]
  pricesLastChecked?: string
  listName?: string    // source Amazon list name
  asin?: string
}
