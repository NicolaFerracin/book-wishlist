import { useState, useEffect, useRef } from 'react'

interface ScrapeStatus {
  running: boolean
  current: number
  total: number
  currentTitle: string
  startedAt: string
  bookStartedAt: string
  log: { title: string; sellers: number; cheapest: { price: number; currency: string } | null; error?: string }[]
  errors: number
}

interface Props {
  onDone: () => void
  scrapeQuery?: string
}

const CUR: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }

function elapsed(iso: string) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function BulkScrapePanel({ onDone, scrapeQuery = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ScrapeStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const prevRunning = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Poll status every 2s when panel is open, or every 10s in background to detect running jobs
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/scrape-all/status')
        const data = await res.json() as ScrapeStatus
        setStatus(data)

        // Detect when a run finishes
        if (prevRunning.current && !data.running) {
          onDone()
        }
        prevRunning.current = data.running
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, open ? 2000 : 10000)
    return () => clearInterval(pollRef.current)
  }, [open, onDone])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [status?.log.length])

  // Auto-open panel if a scrape is already running (e.g. after page refresh)
  useEffect(() => {
    if (status?.running && !open) setOpen(true)
  }, [status?.running])

  const start = async (force = false) => {
    setStarting(true)
    try {
      const res = await fetch(`/api/scrape-all?force=${force ? 1 : 0}&${scrapeQuery}`, { method: 'POST' })
      await res.json()
    } finally {
      setStarting(false)
    }
  }

  if (!status) return null

  const done = !status.running && status.total > 0 && status.log.length === status.total
  const found = status.log.filter(l => l.sellers > 0).length

  return (
    <div>
      {/* Trigger button — shows a live indicator when running */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm transition-colors border border-slate-700"
      >
        {status.running && (
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        {status.running ? `Checking prices (${status.current + 1}/${status.total})` : 'Check all prices'}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-[8vh] min-h-screen" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-white">Bulk Price Check</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Checks AbeBooks, Amazon.es and BookFinder for all books with ISBNs
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Live status bar when running */}
            {status.running && (
              <div className="px-5 pt-4 flex-shrink-0 space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>
                    {status.current + 1} / {status.total} — elapsed {elapsed(status.startedAt)}
                  </span>
                  <span>
                    {found} with offers
                    {status.errors > 0 && <span className="text-red-400 ml-1.5">· {status.errors} failed</span>}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${((status.current + 1) / status.total) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="w-3 h-3 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin flex-shrink-0" />
                  <span className="text-xs text-slate-400 truncate">{status.currentTitle}</span>
                  <span className="text-[10px] text-slate-600 flex-shrink-0 ml-auto">
                    {elapsed(status.bookStartedAt)}
                  </span>
                </div>
              </div>
            )}

            {/* Done summary */}
            {done && !status.running && (
              <div className="px-5 pt-4 flex-shrink-0">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Done — {status.total} books checked{status.errors > 0 ? ` (${status.errors} failed)` : ''}</span>
                  <span>{found} with offers</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                  <div className="h-full bg-emerald-500 rounded-full w-full" />
                </div>
              </div>
            )}

            {/* Log */}
            <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-1 min-h-[200px]">
              {status.log.length === 0 && !status.running && (
                <div className="flex flex-col items-center justify-center h-32 text-slate-600 text-sm">
                  Press Start to check prices for your whole wishlist.
                </div>
              )}
              {status.log.map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/50 last:border-0">
                  <span className="text-xs text-slate-400 truncate min-w-0">{entry.title}</span>
                  {entry.error ? (
                    <span className="text-[10px] text-red-400 flex-shrink-0 truncate max-w-[180px]" title={entry.error}>
                      {entry.error.slice(0, 40)}
                    </span>
                  ) : entry.sellers > 0 ? (
                    <span className="text-xs font-semibold text-emerald-400 flex-shrink-0">
                      {entry.cheapest
                        ? `from ${CUR[entry.cheapest.currency] ?? ''}${entry.cheapest.price.toFixed(2)}`
                        : `${entry.sellers} offers`}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-700 flex-shrink-0">—</span>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="p-5 border-t border-slate-800 flex items-center gap-3 flex-shrink-0">
              {status.running ? (
                <button
                  onClick={async () => { await fetch('/api/scrape-all/stop', { method: 'POST' }) }}
                  className="px-5 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium transition-colors hover:bg-red-500/30"
                >
                  Stop after current book
                </button>
              ) : (
                <>
                  <button
                    onClick={() => start(false)}
                    disabled={starting}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-sm transition-colors"
                  >
                    {starting ? 'Starting...' : 'Check unchecked books'}
                  </button>
                  <button
                    onClick={() => start(true)}
                    disabled={starting}
                    className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl text-sm transition-colors"
                  >
                    Re-check all
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
