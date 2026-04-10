import { useState, useEffect, useRef } from 'react'

interface Props {
  onDone: () => void
  onStarted?: () => void
}

interface CleanupStatus {
  running: boolean
  current: number
  total: number
  currentTitle: string
  removed: number
}

export default function CleanupButton({ onDone, onStarted }: Props) {
  const [status, setStatus] = useState<CleanupStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const prevRunning = useRef(false)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/cleanup-isbns/status')
        const data = await res.json() as CleanupStatus
        setStatus(data)
        if (prevRunning.current && !data.running) onDone()
        prevRunning.current = data.running
      } catch {}
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [onDone])

  const start = async () => {
    setStarting(true)
    const res = await fetch('/api/cleanup-isbns', { method: 'POST' })
    const data = await res.json()
    if (data.started) onStarted?.()
    setStarting(false)
  }

  const stop = async () => {
    await fetch('/api/cleanup-isbns/stop', { method: 'POST' })
  }

  const running = status?.running ?? false

  if (running) {
    return (
      <button
        onClick={stop}
        className="flex items-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl text-sm transition-colors border border-red-500/30"
        title={`Cleaning ${(status?.current ?? 0) + 1}/${status?.total} — ${status?.currentTitle}. ${status?.removed} ISBNs removed so far. Click to stop.`}
      >
        <div className="w-3.5 h-3.5 border-2 border-red-800 border-t-red-400 rounded-full animate-spin" />
        <span className="text-xs">{(status?.current ?? 0) + 1}/{status?.total}</span>
      </button>
    )
  }

  return (
    <button
      onClick={start}
      disabled={starting}
      className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-400 rounded-xl text-sm transition-colors border border-slate-700"
      title="Remove audiobook and wrong-language ISBNs from all books"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  )
}
