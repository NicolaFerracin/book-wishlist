/**
 * Parse a price string that may use European or English number formatting.
 *
 * Rules:
 * - 3 digits after a separator (dot or comma) = thousand separator → remove it
 * - 1-2 digits after a separator = decimal separator → convert to dot
 * - Both separators present: first one is thousand, last one is decimal
 *
 * Examples:
 *   "1,055.91"  → 1055.91   (English: comma=thousand, dot=decimal)
 *   "1.055,91"  → 1055.91   (European: dot=thousand, comma=decimal)
 *   "1.123"     → 1123      (dot + 3 digits = thousand)
 *   "1,123"     → 1123      (comma + 3 digits = thousand)
 *   "46.80"     → 46.80     (dot + 2 digits = decimal)
 *   "46,80"     → 46.80     (comma + 2 digits = decimal)
 *   "1.23"      → 1.23      (dot + 2 digits = decimal)
 *   "1,23"      → 1.23      (comma + 2 digits = decimal)
 *   "12"        → 12
 *   "12.5"      → 12.5      (dot + 1 digit = decimal)
 *   "1,234,567" → 1234567   (multiple comma thousands)
 *   "1.234.567" → 1234567   (multiple dot thousands)
 */
export function parsePrice(raw: string): number {
  let s = raw.trim()

  const hasDot = s.includes('.')
  const hasComma = s.includes(',')

  if (hasDot && hasComma) {
    // Both separators: the LAST one is the decimal separator
    const lastDot = s.lastIndexOf('.')
    const lastComma = s.lastIndexOf(',')
    if (lastComma > lastDot) {
      // Comma is decimal (European): "1.055,91" → remove dots, comma→dot
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // Dot is decimal (English): "1,055.91" → remove commas
      s = s.replace(/,/g, '')
    }
  } else if (hasDot) {
    // Only dots — check what's after the LAST dot
    const afterLast = s.split('.').pop() ?? ''
    if (afterLast.length === 3) {
      // 3 digits after dot = thousand separator: "1.123" → 1123
      s = s.replace(/\./g, '')
    }
    // else: decimal (1-2 digits): "46.80" → keep as-is
  } else if (hasComma) {
    // Only commas — check what's after the LAST comma
    const afterLast = s.split(',').pop() ?? ''
    if (afterLast.length === 3) {
      // 3 digits after comma = thousand separator: "1,123" → 1123
      s = s.replace(/,/g, '')
    } else {
      // 1-2 digits = decimal: "46,80" → "46.80"
      // Replace only the LAST comma with dot (in case of "1,234,56" edge case)
      const lastComma = s.lastIndexOf(',')
      s = s.slice(0, lastComma) + '.' + s.slice(lastComma + 1)
      // Remove remaining commas (thousands): "1,234.56"
      s = s.replace(/,/g, '')
    }
  }

  return parseFloat(s)
}
