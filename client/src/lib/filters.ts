import type { Seller } from '../types'

const US_PATTERNS = [
  /united states/i,
  /estados unidos/i,
  /\bUSA\b/,
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
]

const DISTANT_PATTERNS = [
  /south africa/i,
  /australia/i,
  /japan/i,
  /india/i,
  /brazil/i,
  /brasil/i,
  /china/i,
  /singapore/i,
]

const DISTANT_DOMAINS = [
  'valore.com',
  'valorebooks.com',
]

export function isUSSeller(seller: Seller): boolean {
  const text = `${seller.location ?? ''} ${seller.name ?? ''}`
  return US_PATTERNS.some(p => p.test(text))
}

export function isDistantSeller(seller: Seller): boolean {
  const text = `${seller.location ?? ''} ${seller.name ?? ''}`
  if (DISTANT_PATTERNS.some(p => p.test(text))) return true
  if (DISTANT_DOMAINS.some(d => (seller.url ?? '').includes(d))) return true
  return false
}
