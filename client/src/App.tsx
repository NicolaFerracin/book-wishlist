import { useCallback, useEffect, useState } from 'react'
import BookCard from './components/BookCard'
import BookFormModal from './components/BookFormModal'
import BulkScrapePanel from './components/BulkScrapePanel'
import DealsView from './components/DealsView'
import ImportModal from './components/ImportModal'
import LogsModal from './components/LogsModal'
import EnrichButton from './components/EnrichButton'
import CleanupButton from './components/CleanupButton'
import Toast from './components/Toast'
import { addBook, deleteBook, getBooks, updateBook } from './lib/api'
import type { WishlistBook } from './types'

const REGIONS: Record<string, { label: string; amazonDomain: string; currency: string; country: string }> = {
  pt: { label: 'Portugal', amazonDomain: 'amazon.es', currency: 'EUR', country: 'pt' },
  es: { label: 'Spain', amazonDomain: 'amazon.es', currency: 'EUR', country: 'es' },
  it: { label: 'Italy', amazonDomain: 'amazon.it', currency: 'EUR', country: 'it' },
  de: { label: 'Germany', amazonDomain: 'amazon.de', currency: 'EUR', country: 'de' },
  fr: { label: 'France', amazonDomain: 'amazon.fr', currency: 'EUR', country: 'fr' },
  uk: { label: 'United Kingdom', amazonDomain: 'amazon.co.uk', currency: 'GBP', country: 'gb' },
}

export default function App() {
  const [books, setBooks] = useState<WishlistBook[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingBook, setEditingBook] = useState<WishlistBook | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'deals'>('cards')
  const [expandPrices, setExpandPrices] = useState(false)
  const [excludeUS, setExcludeUS] = useState(false)
  const [excludeDistant, setExcludeDistant] = useState(false)
  const [showNeedsAttention, setShowNeedsAttention] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [region, setRegion] = useState(() => localStorage.getItem('bw-region') || 'pt')

  const regionConfig = REGIONS[region] || REGIONS.es
  const scrapeQuery = `amazonDomain=${regionConfig.amazonDomain}&currency=${regionConfig.currency}&country=${regionConfig.country}`

  const handleRegionChange = (value: string) => {
    setRegion(value)
    localStorage.setItem('bw-region', value)
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    const data = await getBooks()
    setBooks(data.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()))
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const needsAttention = (b: WishlistBook) => !b.isbn && b.isbns.length === 0 || !b.coverUrl
  const needsAttentionCount = books.filter(needsAttention).length

  const filtered = books.filter((b) => {
    if (showNeedsAttention && !needsAttention(b)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q)
  })

  const handleCloseForm = () => { setShowForm(false); setEditingBook(null) }

  const handleSave = async (data: Omit<WishlistBook, 'id' | 'addedAt' | 'prices'>) => {
    if (editingBook) {
      const updated = await updateBook(editingBook.id, data)
      setBooks((prev) => prev.map((b) => (b.id === editingBook.id ? updated : b)))
    } else {
      const created = await addBook(data)
      setBooks((prev) => [created, ...prev])
    }
    handleCloseForm()
  }

  const handleDelete = async () => {
    if (!editingBook) return
    await deleteBook(editingBook.id)
    setBooks((prev) => prev.filter((b) => b.id !== editingBook.id))
    handleCloseForm()
  }

  const handleUpdate = (updated: WishlistBook) => {
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur z-30">
        <div>
          <h1 className="font-serif text-xl font-bold text-white">Book Wishlist</h1>
          {!loading && (
            <p className="text-xs text-slate-600 mt-0.5">{books.length} book{books.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={region}
            onChange={(e) => handleRegionChange(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500/50 cursor-pointer"
          >
            {Object.entries(REGIONS).map(([key, r]) => (
              <option key={key} value={key}>{r.label}</option>
            ))}
          </select>
          <BulkScrapePanel onDone={refresh} scrapeQuery={scrapeQuery} onStarted={() => setToast('Price check running in the background — you can close this window.')} />
          <CleanupButton onDone={refresh} onStarted={() => setToast('ISBN cleanup running — removing audiobooks and wrong-language editions.')} />
          <EnrichButton onDone={refresh} onStarted={() => setToast('Metadata enrichment running in the background — you can close this window.')} />
          <button
            onClick={() => setShowLogs(true)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-sm transition-colors border border-slate-700"
            title="View logs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm transition-colors border border-slate-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Import
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add book
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 pb-24">
        {/* Search */}
        {books.length > 0 && (
          <div className="relative mb-6">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wishlist..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>
        )}

        {/* View toggle + expand all */}
        {books.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('deals')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'deals' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Deals
              </button>
            </div>
            {viewMode === 'cards' && (
              <button
                onClick={() => setExpandPrices(v => !v)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {expandPrices ? 'Collapse all prices' : 'Expand all prices'}
              </button>
            )}
            <button
              onClick={() => setExcludeUS(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${excludeUS ? 'bg-red-500/15 text-red-400 border-red-500/20' : 'text-slate-500 border-slate-800 hover:text-slate-300'}`}
            >
              {excludeUS ? 'US sellers excluded' : 'Exclude US sellers'}
            </button>
            <button
              onClick={() => setExcludeDistant(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${excludeDistant ? 'bg-red-500/15 text-red-400 border-red-500/20' : 'text-slate-500 border-slate-800 hover:text-slate-300'}`}
            >
              {excludeDistant ? 'Distant excluded' : 'Exclude distant'}
            </button>
            {needsAttentionCount > 0 && (
              <button
                onClick={() => setShowNeedsAttention(v => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showNeedsAttention ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' : 'text-slate-500 border-slate-800 hover:text-slate-300'}`}
              >
                {showNeedsAttention ? `Showing ${needsAttentionCount} needing attention` : `${needsAttentionCount} need attention`}
              </button>
            )}
          </div>
        )}

        {/* Book list */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 animate-shimmer rounded-2xl" />
            ))}
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <div className="text-5xl mb-4">📚</div>
            <h2 className="text-lg font-semibold text-white mb-2">Your wishlist is empty</h2>
            <p className="text-slate-500 text-sm mb-6 max-w-xs">Add books you want to read or buy and check second-hand prices across editions.</p>
            <button onClick={() => setShowForm(true)} className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl transition-colors">
              Add your first book
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-600 py-12">No books match "{search}"</p>
        ) : viewMode === 'deals' ? (
          <DealsView books={filtered} excludeUS={excludeUS} excludeDistant={excludeDistant} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onEdit={(b) => { setEditingBook(b); setShowForm(true) }}
                onDelete={async (id) => { await deleteBook(id); setBooks(prev => prev.filter(b => b.id !== id)) }}
                onUpdate={handleUpdate}
                forceShowPrices={expandPrices}
                excludeUS={excludeUS}
                excludeDistant={excludeDistant}
                scrapeQuery={scrapeQuery}
              />
            ))}
          </div>
        )}
      </main>

      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={refresh}
        />
      )}

      {showForm && (
        <BookFormModal
          book={editingBook}
          onSave={handleSave}
          onClose={handleCloseForm}
          onDelete={editingBook ? handleDelete : undefined}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
