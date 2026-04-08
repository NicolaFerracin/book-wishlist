import { useMemo, useState, useCallback } from 'react'
import type { WishlistBook } from '../types'
import { isUSSeller } from '../lib/filters'

interface Deal {
  book: WishlistBook
  isbn: string
  seller: string
  price: number
  currency: string
  condition?: string
  location?: string
  url: string
  source?: string
}

interface SellerGroup {
  seller: string
  location?: string
  deals: Deal[]
  totalPrice: number
  uniqueBooks: number
}

interface Props {
  books: WishlistBook[]
  excludeUS?: boolean
}

const CUR: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }

const SOURCE_STYLES: Record<string, { bg: string; label: string }> = {
  abebooks:   { bg: 'bg-blue-500/15 text-blue-400',   label: 'ABE' },
  amazon:     { bg: 'bg-orange-500/15 text-orange-400', label: 'AMZ' },
  bookfinder: { bg: 'bg-purple-500/15 text-purple-400', label: 'BF' },
}

function SourceBadge({ source }: { source?: string }) {
  const s = SOURCE_STYLES[source ?? ''] ?? { bg: 'bg-slate-700 text-slate-400', label: source?.slice(0, 3).toUpperCase() ?? '???' }
  return <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${s.bg}`}>{s.label}</span>
}
function fmtPrice(price: number, currency: string) {
  return `${CUR[currency] ?? currency}${price.toFixed(2)}`
}

function DealRow({ deal, showBook = true }: { deal: Deal; showBook?: boolean }) {
  return (
    <a
      href={deal.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors group"
    >
      {showBook && (
        <div className="flex-shrink-0 w-8 h-12 rounded overflow-hidden bg-slate-800">
          {deal.book.coverUrl ? (
            <img src={deal.book.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-800" />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate group-hover:text-amber-300 transition-colors">
          {deal.book.title}
        </p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1.5">
          <SourceBadge source={deal.source} />
          {showBook ? (
            <span className="truncate">
              {deal.seller}
              {deal.condition && <span className="text-slate-600"> · {deal.condition}</span>}
              {deal.location && <span className="text-slate-700"> · {deal.location}</span>}
            </span>
          ) : (
            <span className="truncate">
              {deal.condition && <span className="text-slate-600">{deal.condition}</span>}
              {deal.condition && deal.isbn && <span className="text-slate-700"> · </span>}
              <span className="text-slate-700 font-mono">{deal.isbn}</span>
            </span>
          )}
        </p>
      </div>
      <p className="text-sm font-semibold text-emerald-400 flex-shrink-0">
        {fmtPrice(deal.price, deal.currency)}
      </p>
      <svg className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}

const PREVIEW_COUNT = 5

function SellerGroupCard({ group }: { group: SellerGroup }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(() => [...group.deals].sort((a, b) => a.price - b.price), [group.deals])
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT)
  const remaining = sorted.length - PREVIEW_COUNT

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <div>
          <h3 className="text-sm font-semibold text-white">{group.seller}</h3>
          {group.location && (
            <p className="text-[11px] text-slate-600">{group.location}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">
            {group.uniqueBooks} book{group.uniqueBooks !== 1 ? 's' : ''}
          </p>
          <p className="text-xs font-semibold text-emerald-400">
            total {fmtPrice(group.totalPrice, group.deals[0]?.currency ?? 'EUR')}
          </p>
        </div>
      </div>
      <div className="space-y-1">
        {visible.map((deal, i) => (
          <DealRow key={`${deal.book.id}-${i}`} deal={deal} showBook={true} />
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full mt-1.5 py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors text-center rounded-lg hover:bg-slate-900"
        >
          {expanded ? 'Show less' : `+${remaining} more book${remaining !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

export default function DealsView({ books, excludeUS }: Props) {
  const [groupBy, setGroupBy] = useState<'price' | 'seller'>('price')

  const deals = useMemo(() => {
    const all: Deal[] = []
    for (const book of books) {
      // Deduplicate: only keep the cheapest offer per book+seller combo
      const seen = new Map<string, Deal>()
      for (const pr of book.prices) {
        for (const s of pr.sellers) {
          if (excludeUS && isUSSeller(s)) continue
          const key = s.name
          const existing = seen.get(key)
          if (!existing || s.price < existing.price) {
            seen.set(key, {
              book, isbn: pr.isbn, seller: s.name, price: s.price,
              currency: s.currency, condition: s.condition, location: s.location, url: s.url, source: s.source,
            })
          }
        }
      }
      all.push(...seen.values())
    }
    return all.sort((a, b) => a.price - b.price)
  }, [books, excludeUS])

  const sellerGroups = useMemo(() => {
    const map = new Map<string, SellerGroup>()
    for (const deal of deals) {
      const key = deal.seller
      let group = map.get(key)
      if (!group) {
        group = { seller: deal.seller, location: deal.location, deals: [], totalPrice: 0, uniqueBooks: 0 }
        map.set(key, group)
      }
      group.deals.push(deal)
      group.totalPrice += deal.price
    }
    // Count unique books per seller
    for (const g of map.values()) {
      g.uniqueBooks = new Set(g.deals.map(d => d.book.id)).size
    }
    // Sort by cheapest single item (so the seller with the best deal shows first)
    return [...map.values()].sort((a, b) => {
      const aMin = Math.min(...a.deals.map(d => d.price))
      const bMin = Math.min(...b.deals.map(d => d.price))
      return aMin - bMin
    })
  }, [deals])

  if (deals.length === 0) {
    return (
      <div className="text-center py-16 text-slate-600 text-sm">
        No price data yet. Run "Check all prices" first.
      </div>
    )
  }

  const uniqueBooks = new Set(deals.map(d => d.book.id)).size

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-600">
          {deals.length} offers across {uniqueBooks} books
        </p>
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
          <button
            onClick={() => setGroupBy('price')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${groupBy === 'price' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            By price
          </button>
          <button
            onClick={() => setGroupBy('seller')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${groupBy === 'seller' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            By seller
          </button>
        </div>
      </div>

      {groupBy === 'price' ? (
        /* ── Flat list sorted by price ─────────────────────────────────────── */
        <div className="space-y-1">
          {deals.map((deal, i) => (
            <DealRow key={`${deal.book.id}-${deal.isbn}-${deal.seller}-${i}`} deal={deal} />
          ))}
        </div>
      ) : (
        /* ── Grouped by seller ────────────────────────────────────────────── */
        <div className="space-y-6">
          {sellerGroups.map((group) => (
            <SellerGroupCard key={group.seller} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}
