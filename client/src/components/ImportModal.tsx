import { useState, useRef } from 'react'

interface Props {
  onClose: () => void
  onImported: () => void
}

type Source = 'amazon' | 'goodreads'

export default function ImportModal({ onClose, onImported }: Props) {
  const [source, setSource] = useState<Source>('amazon')
  const [step, setStep] = useState<'instructions' | 'uploading' | 'done'>('instructions')
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStep('uploading')
    setError(null)

    try {
      if (source === 'amazon') {
        const allItems: { name: string; url: string; imageUrl?: string; dateAdded?: string; comment?: string }[] = []
        for (const file of Array.from(files)) {
          const text = await file.text()
          const data = JSON.parse(text)
          if (data.items && Array.isArray(data.items)) {
            allItems.push(...data.items)
          } else if (Array.isArray(data)) {
            allItems.push(...data)
          }
        }
        const res = await fetch('/api/books/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: allItems }),
        })
        if (!res.ok) throw new Error('Import failed')
        const r = await res.json()
        setResult({ added: r.added, skipped: r.skipped })
      } else {
        // Goodreads CSV — send raw text, server parses it
        const text = await files[0].text()
        const res = await fetch('/api/books/import-goodreads', {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: text,
        })
        if (!res.ok) throw new Error('Import failed')
        const r = await res.json()
        setResult({ added: r.added, skipped: r.skipped })
      }

      setStep('done')
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import')
      setStep('instructions')
    }
  }

  const resetForNewUpload = () => {
    setStep('instructions')
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-[10vh] min-h-screen" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Import Books</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Source tabs */}
          {step === 'instructions' && (
            <div className="flex bg-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => { setSource('amazon'); resetForNewUpload() }}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${source === 'amazon' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Amazon
              </button>
              <button
                onClick={() => { setSource('goodreads'); resetForNewUpload() }}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${source === 'goodreads' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Goodreads
              </button>
            </div>
          )}

          {step === 'instructions' && source === 'amazon' && (
            <>
              <div className="space-y-3 text-sm text-slate-400">
                <p className="text-white font-medium">How to export your Amazon wishlist:</p>
                <ol className="list-decimal list-inside space-y-2 text-slate-400">
                  <li>
                    Install the{' '}
                    <a
                      href="https://chromewebstore.google.com/detail/amazon-wishlist-exporter/jggmpdkkdepkhdbmfplkabhjkahgnoip"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:text-amber-300 underline"
                    >
                      Amazon Wishlist Exporter
                    </a>{' '}
                    Chrome extension
                  </li>
                  <li>Go to your Amazon wishlist page</li>
                  <li>Click the extension icon and select <strong className="text-slate-300">Export as JSON</strong></li>
                  <li>Repeat for each wishlist you want to import</li>
                  <li>Upload the JSON file(s) below</li>
                </ol>
                <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-500">
                  The JSON files should have the format: <code className="text-slate-400">{"{ listName, items: [...] }"}</code>
                  <br />Duplicate books (same title) are automatically skipped.
                </div>
              </div>
              <UploadArea fileRef={fileRef} accept=".json" multiple onFiles={handleFiles} error={error} />
            </>
          )}

          {step === 'instructions' && source === 'goodreads' && (
            <>
              <div className="space-y-3 text-sm text-slate-400">
                <p className="text-white font-medium">How to export from Goodreads:</p>
                <ol className="list-decimal list-inside space-y-2 text-slate-400">
                  <li>
                    Go to{' '}
                    <a
                      href="https://www.goodreads.com/review/import"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:text-amber-300 underline"
                    >
                      goodreads.com/review/import
                    </a>
                  </li>
                  <li>Click <strong className="text-slate-300">Export Library</strong> at the top</li>
                  <li>Wait for the export to complete, then download the CSV</li>
                  <li>Upload the CSV file below</li>
                </ol>
                <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-500">
                  Only books on your <strong className="text-slate-400">to-read</strong> shelf are imported.
                  Books already in your wishlist (by title) are skipped.
                  ISBN and page count are pulled directly from the CSV.
                </div>
              </div>
              <UploadArea fileRef={fileRef} accept=".csv" multiple={false} onFiles={handleFiles} error={error} />
            </>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center py-8">
              <div className="w-8 h-8 border-3 border-slate-600 border-t-amber-400 rounded-full animate-spin mb-4" />
              <p className="text-sm text-slate-400">Importing books...</p>
            </div>
          )}

          {step === 'done' && result && (
            <DoneStep added={result.added} skipped={result.skipped} onClose={onClose} onImported={onImported} />
          )}
        </div>
      </div>
    </div>
  )
}

function DoneStep({ added, skipped, onClose, onImported }: { added: number; skipped: number; onClose: () => void; onImported: () => void }) {
  const [enriching, setEnriching] = useState(false)
  const [enrichDone, setEnrichDone] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, title: '' })

  const startEnrich = async () => {
    setEnriching(true)
    await fetch('/api/enrich', { method: 'POST' })

    const poll = setInterval(async () => {
      const res = await fetch('/api/enrich/status')
      const data = await res.json()
      setProgress({ current: data.current + 1, total: data.total, title: data.currentTitle })
      if (!data.running && data.total > 0) {
        clearInterval(poll)
        setEnriching(false)
        setEnrichDone(true)
        onImported()
      }
    }, 2000)
  }

  return (
    <div className="text-center py-4">
      <div className="text-3xl mb-3">&#10003;</div>
      <p className="text-white font-medium">
        {added} book{added !== 1 ? 's' : ''} imported
      </p>
      {skipped > 0 && (
        <p className="text-sm text-slate-500 mt-1">{skipped} skipped (duplicates or already-read)</p>
      )}

      {enriching && (
        <div className="mt-4 space-y-2">
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-slate-500">
            Enriching {progress.current}/{progress.total} — {progress.title?.slice(0, 40)}
          </p>
        </div>
      )}

      {enrichDone && (
        <p className="mt-4 text-xs text-emerald-400">Metadata enrichment complete.</p>
      )}

      <div className="flex items-center justify-center gap-3 mt-6">
        {!enriching && !enrichDone && (
          <button
            onClick={startEnrich}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm transition-colors border border-slate-700"
          >
            Fetch covers & ISBNs
          </button>
        )}
        <button
          onClick={onClose}
          disabled={enriching}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-sm transition-colors"
        >
          {enrichDone ? 'Done' : enriching ? 'Enriching...' : 'Skip'}
        </button>
      </div>
    </div>
  )
}

function UploadArea({ fileRef, accept, multiple, onFiles, error }: {
  fileRef: React.RefObject<HTMLInputElement | null>
  accept: string
  multiple: boolean
  onFiles: (files: FileList | null) => void
  error: string | null
}) {
  return (
    <>
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-amber-500/50 transition-colors cursor-pointer"
      >
        <svg className="w-8 h-8 mx-auto text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm text-slate-500">Click to upload {accept} file{multiple ? 's' : ''}</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </>
  )
}
