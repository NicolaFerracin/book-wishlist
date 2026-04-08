import { useState, useEffect, useRef } from 'react'

interface LogEntry {
  timestamp: string
  level: 'error' | 'warn' | 'info'
  source: string
  message: string
  details?: string
}

interface Props {
  onClose: () => void
}

const LEVEL_STYLES = {
  error: 'text-red-400 bg-red-500/10',
  warn: 'text-amber-400 bg-amber-500/10',
  info: 'text-blue-400 bg-blue-500/10',
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleString()
}

export default function LogsModal({ onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async () => {
    setLoading(true)
    const res = await fetch('/api/logs')
    const data = await res.json()
    setLogs(data)
    setLoading(false)
  }

  useEffect(() => { fetchLogs() }, [])

  const handleClear = async () => {
    await fetch('/api/logs', { method: 'DELETE' })
    setLogs([])
  }

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter)
  const errorCount = logs.filter(l => l.level === 'error').length
  const warnCount = logs.filter(l => l.level === 'warn').length

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-[6vh] min-h-screen" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Logs</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {logs.length} entries
              {errorCount > 0 && <span className="text-red-400 ml-1.5">{errorCount} errors</span>}
              {warnCount > 0 && <span className="text-amber-400 ml-1.5">{warnCount} warnings</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 pt-4 flex items-center gap-3 flex-shrink-0">
          <div className="flex bg-slate-800 rounded-lg p-0.5">
            {(['all', 'error', 'warn', 'info'] as const).map(level => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === level ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {level === 'all' ? `All (${logs.length})` : level === 'error' ? `Errors (${errorCount})` : level === 'warn' ? `Warnings (${warnCount})` : `Info (${logs.length - errorCount - warnCount})`}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={fetchLogs} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Refresh
          </button>
        </div>

        {/* Log entries */}
        <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-1 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
              {logs.length === 0 ? 'No logs yet.' : 'No matching entries.'}
            </div>
          ) : (
            [...filtered].reverse().map((entry, i) => {
              const realIdx = filtered.length - 1 - i
              const isExpanded = expandedIdx === realIdx
              return (
                <div
                  key={i}
                  onClick={() => setExpandedIdx(isExpanded ? null : realIdx)}
                  className={`rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-800' : 'hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${LEVEL_STYLES[entry.level]}`}>
                      {entry.level.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0">{entry.source}</span>
                    <span className="text-xs text-slate-400 truncate">{entry.message}</span>
                    <span className="text-[10px] text-slate-700 flex-shrink-0 ml-auto">{timeStr(entry.timestamp)}</span>
                  </div>
                  {isExpanded && entry.details && (
                    <pre className="mt-2 text-[11px] text-slate-500 whitespace-pre-wrap break-all bg-slate-900 rounded p-2">
                      {entry.details}
                    </pre>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="px-5 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium transition-colors hover:bg-red-500/30 disabled:opacity-30"
          >
            Clear all logs
          </button>
        </div>
      </div>
    </div>
  )
}
