import { parsePrice } from './parsePrice.js'

const cases: [string, number][] = [
  // Simple integers
  ['12', 12],
  ['100', 100],

  // Dot as decimal (English standard)
  ['1.23', 1.23],
  ['46.80', 46.80],
  ['12.5', 12.5],
  ['0.99', 0.99],
  ['100.00', 100],

  // Comma as decimal (European)
  ['1,23', 1.23],
  ['46,80', 46.80],
  ['12,5', 12.5],
  ['0,99', 0.99],

  // Dot as thousand separator (3 digits after)
  ['1.123', 1123],
  ['1.050', 1050],
  ['12.345', 12345],
  ['1.234.567', 1234567],

  // Comma as thousand separator (3 digits after)
  ['1,123', 1123],
  ['1,050', 1050],
  ['12,345', 12345],
  ['1,234,567', 1234567],

  // Both: English format (comma=thousand, dot=decimal)
  ['1,055.91', 1055.91],
  ['1,049.60', 1049.60],
  ['21,005.50', 21005.50],
  ['1,234,567.89', 1234567.89],

  // Both: European format (dot=thousand, comma=decimal)
  ['1.055,91', 1055.91],
  ['1.049,60', 1049.60],
  ['21.005,50', 21005.50],
  ['1.234.567,89', 1234567.89],

  // Real-world prices from BookFinder
  ['21.05', 21.05],
  ['7.99', 7.99],
  ['6.31', 6.31],
  ['1,055.91', 1055.91],
  ['1,141.60', 1141.60],
  ['38.97', 38.97],
  ['25.42', 25.42],

  // Edge cases
  ['0.47', 0.47],
  ['3.00', 3],
  ['10,00', 10],
  ['1.000', 1000],
  ['1,000', 1000],
]

let passed = 0
let failed = 0

for (const [input, expected] of cases) {
  const result = parsePrice(input)
  const ok = Math.abs(result - expected) < 0.001
  if (!ok) {
    console.error(`FAIL: parsePrice("${input}") = ${result}, expected ${expected}`)
    failed++
  } else {
    passed++
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${cases.length} tests`)
if (failed > 0) process.exit(1)
