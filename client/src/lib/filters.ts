import type { Seller } from '../types'

const US_PATTERNS = [
  /united states/i,
  /estados unidos/i,
  /\bUSA\b/,
  // US state abbreviations after a comma: ", CA", ", NY" etc.
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
]

export function isUSSeller(seller: Seller): boolean {
  const text = `${seller.location ?? ''} ${seller.name ?? ''}`
  return US_PATTERNS.some(p => p.test(text))
}
