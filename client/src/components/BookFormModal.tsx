import { useState, useEffect, useRef } from 'react'
import { searchBooks, lookupByIsbn, fetchAllIsbns, fetchEditions, type Edition } from '../lib/openLibrary'
import type { WishlistBook, OpenLibraryResult } from '../types'

type BookInput = Omit<WishlistBook, 'id' | 'addedAt' | 'prices'>

interface Props {
  book: WishlistBook | null
  onSave: (data: BookInput) => Promise<void>
  onClose: () => void
  onDelete?: () => Promise<void>
}

const AUDIO_RE = /audio|cd|mp3|cassette|spoken/i

function EditionLabel({ ed }: { ed: Edition }) {
  return (
    <span className="text-[10px] text-slate-600 truncate">
      {ed.language && <span className="uppercase">{ed.language}</span>}
      {ed.format && <span> · {ed.format}</span>}
      {ed.publisher && <span> · {ed.publisher}</span>}
      {ed.year && <span> · {ed.year}</span>}
    </span>
  )
}

function IsbnManager({ isbns, onChange, book }: { isbns: string[]; onChange: (v: string[]) => void; book: WishlistBook | null }) {
  const [expanded, setExpanded] = useState(false)
  const [allEditions, setAllEditions] = useState<Edition[]>([])
  const [loadingEditions, setLoadingEditions] = useState(false)

  const selected = new Set(isbns)

  const loadEditionDetails = async () => {
    if (allEditions.length > 0) return
    setLoadingEditions(true)
    const primaryIsbn = book?.isbn || book?.asin || isbns[0]
    if (primaryIsbn) {
      try {
        const res = await fetch(`https://openlibrary.org/isbn/${primaryIsbn.replace(/[-\s]/g, '')}.json`)
        if (res.ok) {
          const data = await res.json()
          const workKey = data.works?.[0]?.key
          if (workKey) {
            const eds = await fetchEditions(workKey)
            // Deduplicate by ISBN, keep first occurrence
            const seen = new Set<string>()
            const unique = eds.filter(e => { if (seen.has(e.isbn)) return false; seen.add(e.isbn); return true })
            setAllEditions(unique)
          }
        }
      } catch {}
    }
    setLoadingEditions(false)
  }

  const handleExpand = () => {
    if (!expanded) loadEditionDetails()
    setExpanded(v => !v)
  }

  const toggle = (isbn: string) => {
    if (selected.has(isbn)) {
      // Don't allow removing the last one
      if (isbns.length <= 1) return
      onChange(isbns.filter(i => i !== isbn))
    } else {
      onChange([...isbns, isbn])
    }
  }

  // Partition: selected first, then unselected. Within each, sort by: same-language first, then no-audio first
  const sortedEditions = allEditions.length > 0
    ? [...allEditions].sort((a, b) => {
        const aSelected = selected.has(a.isbn) ? 0 : 1
        const bSelected = selected.has(b.isbn) ? 0 : 1
        if (aSelected !== bSelected) return aSelected - bSelected
        const aAudio = a.format && AUDIO_RE.test(a.format) ? 1 : 0
        const bAudio = b.format && AUDIO_RE.test(b.format) ? 1 : 0
        return aAudio - bAudio
      })
    : []

  return (
    <div className="bg-slate-800/30 rounded-xl px-3 py-2">
      <button type="button" onClick={handleExpand} className="flex items-center justify-between w-full text-xs text-slate-500 hover:text-slate-300 transition-colors">
        <span>{isbns.length} ISBN{isbns.length !== 1 ? 's' : ''} selected for price checking</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
          {loadingEditions && <p className="text-[10px] text-slate-600 py-2">Loading available editions...</p>}

          {sortedEditions.length > 0 ? sortedEditions.map(ed => {
            const isSelected = selected.has(ed.isbn)
            const isAudio = ed.format && AUDIO_RE.test(ed.format)
            return (
              <label
                key={ed.isbn}
                className={`flex items-center gap-2 py-1.5 px-1 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'} ${isAudio ? 'opacity-40' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(ed.isbn)}
                  className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50 cursor-pointer flex-shrink-0"
                />
                <span className="text-[11px] font-mono text-slate-400 w-28 flex-shrink-0">{ed.isbn}</span>
                <EditionLabel ed={ed} />
              </label>
            )
          }) : !loadingEditions && isbns.map(isbn => (
            <div key={isbn} className="flex items-center gap-2 py-1.5 px-1">
              <input type="checkbox" checked disabled className="w-3.5 h-3.5 rounded flex-shrink-0" />
              <span className="text-[11px] font-mono text-slate-400">{isbn}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BookFormModal({ book, onSave, onClose, onDelete }: Props) {
  const [title, setTitle] = useState(book?.title || '')
  const [author, setAuthor] = useState(book?.author || '')
  const [pages, setPages] = useState(book?.pages?.toString() || '')
  const [notes, setNotes] = useState(book?.notes || '')
  const [coverUrl, setCoverUrl] = useState(book?.coverUrl || '')
  const [isbn, setIsbn] = useState(book?.isbn || '')
  const [isbns, setIsbns] = useState<string[]>(book?.isbns || [])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [fetchingIsbns, setFetchingIsbns] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null)

  const [results, setResults] = useState<OpenLibraryResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [isbnLooking, setIsbnLooking] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()
  const isbnTimeout = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!book && title.length >= 2) {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
      setSearching(true)
      searchTimeout.current = setTimeout(async () => {
        const data = await searchBooks(title)
        setResults(data)
        setSearching(false)
        setShowResults(true)
      }, 400)
    } else {
      setShowResults(false)
    }
  }, [title, book])

  const handleIsbnChange = (value: string) => {
    setIsbn(value)
    setRefreshSummary(null)
    if (isbnTimeout.current) clearTimeout(isbnTimeout.current)
    const clean = value.replace(/[-\s]/g, '')
    if (/^\d{10}(\d{3})?$/.test(clean)) {
      setIsbnLooking(true)
      isbnTimeout.current = setTimeout(async () => {
        const result = await lookupByIsbn(clean)
        if (result) {
          setTitle(result.title)
          setAuthor(result.author)
          if (result.pages) setPages(String(result.pages))
          if (result.coverUrl) setCoverUrl(result.coverUrl)
          // Only select the primary ISBN by default — user can add more via the ISBN manager
          setIsbns([clean])
        } else {
          // Not found anywhere — at least keep the ISBN itself for price checking
          setIsbns([clean])
          setRefreshSummary(`ISBN not found on Open Library or Google Books — fill in the title manually.`)
        }
        setIsbnLooking(false)
      }, 300)
    }
  }

  const selectResult = async (result: OpenLibraryResult) => {
    setTitle(result.title)
    setAuthor(result.author)
    if (result.pages) setPages(String(result.pages))
    if (result.coverUrl) setCoverUrl(result.coverUrl)
    if (result.isbn) setIsbn(result.isbn)
    setResults([])
    setShowResults(false)

    // Only select the primary ISBN — user can add more via the ISBN manager
    if (result.isbn) {
      setIsbns([result.isbn])
    }
  }

  const handleRefreshMetadata = async () => {
    setRefreshing(true)
    setRefreshSummary(null)
    try {
      let result: Awaited<ReturnType<typeof lookupByIsbn>> = null
      const cleanIsbn = isbn.replace(/[-\s]/g, '')
      if (cleanIsbn) result = await lookupByIsbn(cleanIsbn)
      if (!result) {
        const results = await searchBooks(`${title} ${author}`.trim())
        if (results[0]) result = results[0]
      }
      if (!result) {
        // Still use the current ISBN for price checking even if metadata lookup failed
        const cleanIsbn = isbn.replace(/[-\s]/g, '')
        if (cleanIsbn && !isbns.includes(cleanIsbn)) setIsbns([cleanIsbn])
        setRefreshSummary(
          cleanIsbn
            ? `Not found on Open Library or Google Books — ISBN ${cleanIsbn} saved for price checking.`
            : 'Not found on Open Library or Google Books.'
        )
        return
      }

      const changes: string[] = []
      if (result.title && result.title !== title) { setTitle(result.title); changes.push('title') }
      if (result.author && result.author !== author) { setAuthor(result.author); changes.push('author') }
      if (result.pages && String(result.pages) !== pages) { setPages(String(result.pages)); changes.push(`${result.pages} pages`) }
      if (result.coverUrl && result.coverUrl !== coverUrl) { setCoverUrl(result.coverUrl); changes.push('cover') }
      if (result.isbn && result.isbn !== isbn) { setIsbn(result.isbn); changes.push('ISBN') }

      // Keep existing ISBNs (user-curated), just make sure primary is included
      const newIsbns = result.isbn && !isbns.includes(result.isbn) ? [result.isbn, ...isbns] : isbns
      setIsbns(newIsbns)

      const isbnNote = `${newIsbns.length} ISBN${newIsbns.length !== 1 ? 's' : ''} selected`
      setRefreshSummary(
        changes.length > 0
          ? `Updated: ${changes.join(', ')} · ${isbnNote}`
          : `No field changes · ${isbnNote}`
      )
    } finally {
      setRefreshing(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      author: author.trim(),
      pages: pages ? Number(pages) : undefined,
      notes: notes.trim() || undefined,
      coverUrl: coverUrl || undefined,
      isbn: isbn || undefined,
      isbns,
    })
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    if (onDelete) { setSaving(true); await onDelete() }
  }

  const inputCls = 'w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50'
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-[10vh] overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">{book ? 'Edit Book' : 'Add to Wishlist'}</h2>
          <div className="flex items-center gap-3">
            {book && (
              <button
                type="button"
                onClick={handleRefreshMetadata}
                disabled={refreshing || fetchingIsbns}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 disabled:opacity-40 transition-colors"
                title="Re-fetch title, author, cover and ISBNs from Open Library"
              >
                {(refreshing || fetchingIsbns) ? (
                  <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Refresh metadata
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Cover preview + URL */}
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-20 h-28 rounded-lg overflow-hidden bg-slate-800">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
                  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className={labelCls}>Cover image URL</label>
              <input type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} className={inputCls} placeholder="Paste an image URL..." />
            </div>
          </div>

          {/* ISBN lookup */}
          <div className="relative">
            <label className={labelCls}>ISBN</label>
            <input type="text" value={isbn} onChange={(e) => handleIsbnChange(e.target.value)} className={inputCls} placeholder="Paste ISBN to auto-fill..." />
            {(isbnLooking || fetchingIsbns) && (
              <div className="absolute right-3 top-8">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin" />
              </div>
            )}
          </div>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[10px] text-slate-600 uppercase tracking-wider">or search by title</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          {/* Title search */}
          <div className="relative">
            <label className={labelCls}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
              onKeyDown={(e) => { if (e.key === 'Escape') setShowResults(false) }}
              className={inputCls}
              placeholder="Search or enter book title..."
              required
              autoFocus
            />
            {searching && (
              <div className="absolute right-3 top-8">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin" />
              </div>
            )}
            {showResults && results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-10 max-h-64 overflow-y-auto">
                {results.map((r, i) => (
                  <button key={i} type="button" onClick={() => selectResult(r)} className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 transition-colors text-left border-b border-slate-700/50 last:border-0">
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" className="w-8 h-12 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-12 rounded bg-slate-600 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{r.title}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {r.author}{r.firstPublishYear ? ` (${r.firstPublishYear})` : ''}{r.pages ? ` · ${r.pages}p` : ''}
                      </p>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${r.source === 'googlebooks' ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-700 text-slate-500'}`}>
                      {r.source === 'googlebooks' ? 'GB' : 'OL'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Author */}
          <div>
            <label className={labelCls}>Author</label>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className={inputCls} placeholder="Author name" />
          </div>

          {/* Pages */}
          <div>
            <label className={labelCls}>Pages</label>
            <input type="number" value={pages} onChange={(e) => setPages(e.target.value)} className={inputCls} placeholder="300" min={1} />
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Why you want to read this..." />
          </div>

          {/* ISBNs / refresh summary */}
          {fetchingIsbns ? (
            <p className="text-xs text-slate-500">Fetching editions...</p>
          ) : refreshSummary ? (
            <p className={`text-xs px-3 py-2 rounded-lg ${refreshSummary.startsWith('Nothing') || refreshSummary.startsWith('Not found') || refreshSummary.startsWith('ISBN not found') ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {refreshSummary}
            </p>
          ) : null}

          {/* ISBN manager */}
          {isbns.length > 0 && (
            <IsbnManager isbns={isbns} onChange={setIsbns} book={book} />
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            {onDelete && (
              <button type="button" onClick={handleDelete} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${confirmDelete ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-slate-500 hover:text-red-400'}`}>
                {confirmDelete ? 'Confirm delete' : 'Delete'}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={saving || !title.trim()} className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-xl text-sm transition-colors">
              {saving ? 'Saving...' : book ? 'Save' : 'Add to Wishlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
