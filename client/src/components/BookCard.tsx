import { useState, useMemo } from 'react'
import { scrapeBookPrices } from '../lib/api'
import { isUSSeller } from '../lib/filters'
import type { WishlistBook } from '../types'

interface Props {
  book: WishlistBook
  onEdit: (book: WishlistBook) => void
  onUpdate: (book: WishlistBook) => void
  forceShowPrices?: boolean
  excludeUS?: boolean
  scrapeQuery?: string
}

const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }

function formatPrice(price: number, currency: string) {
  return `${CURRENCY_SYMBOL[currency] ?? currency}${price.toFixed(2)}`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function BookCard({ book, onEdit, onUpdate, forceShowPrices, excludeUS, scrapeQuery }: Props) {
  const [scraping, setScraping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localShowPrices, setLocalShowPrices] = useState(false)
  const showPrices = forceShowPrices || localShowPrices

  const filteredPrices = useMemo(() => {
    if (!excludeUS) return book.prices
    return book.prices.map(pr => ({
      ...pr,
      sellers: pr.sellers.filter(s => !isUSSeller(s)),
    }))
  }, [book.prices, excludeUS])

  const allSellers = filteredPrices.flatMap((p) => p.sellers)
  const cheapest = allSellers.length > 0 ? allSellers.reduce((a, b) => (a.price < b.price ? a : b)) : null

  const handleScrape = async () => {
    setScraping(true)
    setError(null)
    try {
      const updated = await scrapeBookPrices(book.id, scrapeQuery)
      onUpdate(updated)
      setLocalShowPrices(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch prices')
    } finally {
      setScraping(false)
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-all">
      {/* Top row: cover + info */}
      <div className="flex gap-4 p-4">
        <div className="flex-shrink-0 w-16 h-24 rounded-lg overflow-hidden bg-slate-800">
          {book.coverUrl ? (
            <img src={book.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
              <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm leading-tight line-clamp-2">{book.title}</h3>
          {book.author && <p className="text-slate-500 text-xs mt-0.5 truncate">{book.author}</p>}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {book.pages && <span className="text-slate-600 text-[10px]">{book.pages}p</span>}
            {book.isbns.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700">
                {book.isbns.length} edition{book.isbns.length > 1 ? 's' : ''}
              </span>
            )}
            {cheapest && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                from {formatPrice(cheapest.price, cheapest.currency)}
              </span>
            )}
          </div>

          {book.notes && (
            <p className="text-slate-600 text-xs mt-1.5 line-clamp-1 italic">"{book.notes}"</p>
          )}
        </div>

        {/* Edit button */}
        <button onClick={() => onEdit(book)} className="flex-shrink-0 text-slate-600 hover:text-slate-300 transition-colors self-start mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>

      {/* Price section */}
      <div className="border-t border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setLocalShowPrices((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
            disabled={filteredPrices.length === 0}
          >
            {filteredPrices.some(p => p.sellers.length > 0) ? (
              <>
                <span>{showPrices ? 'Hide prices' : 'Show prices'}</span>
                {book.pricesLastChecked && (
                  <span className="text-slate-700">· {timeAgo(book.pricesLastChecked)}</span>
                )}
              </>
            ) : book.pricesLastChecked ? (
              <span className="text-slate-700">No offers{excludeUS ? ' (excl. US)' : ''}</span>
            ) : (
              <span className="text-slate-700">No prices yet</span>
            )}
          </button>

          {(book.isbn || book.asin || book.isbns[0]) && (
            <a
              href={`https://www.isbns.net/isbn/${book.isbn || book.asin || book.isbns[0]}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              isbns.net
            </a>
          )}

          <button
            onClick={handleScrape}
            disabled={scraping || book.isbns.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition-colors flex items-center gap-1.5"
          >
            {scraping ? (
              <>
                <div className="w-3 h-3 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {book.pricesLastChecked ? 'Refresh' : 'Check prices'}
              </>
            )}
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        {showPrices && filteredPrices.some(p => p.sellers.length > 0) && (
          <div className="mt-3 space-y-3">
            {filteredPrices
              .filter((p) => p.sellers.length > 0)
              .map((priceResult) => (
                <div key={priceResult.isbn}>
                  <p className="text-[10px] text-slate-600 mb-1.5 font-mono">{priceResult.isbn}</p>
                  <div className="space-y-1">
                    {priceResult.sellers.slice(0, 6).map((seller, i) => (
                      <a
                        key={i}
                        href={seller.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {seller.source && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                              seller.source === 'amazon' ? 'bg-orange-500/15 text-orange-400' :
                              seller.source === 'bookfinder' ? 'bg-purple-500/15 text-purple-400' :
                              'bg-blue-500/15 text-blue-400'
                            }`}>{seller.source === 'abebooks' ? 'ABE' : seller.source === 'amazon' ? 'AMZ' : 'BF'}</span>
                          )}
                          <span className="text-xs text-slate-300 truncate">{seller.name}</span>
                          {seller.condition && (
                            <span className="text-[10px] text-slate-600 truncate">{seller.condition}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-semibold text-emerald-400">
                            {formatPrice(seller.price, seller.currency)}
                          </span>
                          <svg className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </div>
                      </a>
                    ))}
                    {priceResult.sellers.length > 6 && (
                      <p className="text-[10px] text-slate-700 text-center pt-1">
                        +{priceResult.sellers.length - 6} more offers
                      </p>
                    )}
                  </div>
                </div>
              ))}
            {filteredPrices.every((p) => p.sellers.length === 0) && (
              <p className="text-xs text-slate-600 text-center py-2">
                No prices found on iberlibro.com (AbeBooks) for the ISBNs checked.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
