import { useState, useEffect, useRef } from 'react'

interface Props {
  onDone: () => void
  onStarted?: () => void
}

interface EnrichStatus {
  running: boolean
  current: number
  total: number
  currentTitle: string
}

export default function EnrichButton({ onDone, onStarted }: Props) {
  const [status, setStatus] = useState<EnrichStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const prevRunning = useRef(false)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/enrich/status')
        const data = await res.json() as EnrichStatus
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
    const res = await fetch('/api/enrich', { method: 'POST' })
    const data = await res.json()
    if (data.started) onStarted?.()
    setStarting(false)
  }

  const stop = async () => {
    await fetch('/api/enrich/stop', { method: 'POST' })
  }

  const running = status?.running ?? false

  if (running) {
    return (
      <button
        onClick={stop}
        className="flex items-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl text-sm transition-colors border border-red-500/30"
        title={`Enriching ${(status?.current ?? 0) + 1}/${status?.total} — ${status?.currentTitle}. Click to stop.`}
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
      title="Fetch covers & ISBNs for books missing metadata"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  )
}
