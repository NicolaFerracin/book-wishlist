import { useState, useRef } from 'react'

interface Props {
  onClose: () => void
  onImported: () => void
}

export default function ImportModal({ onClose, onImported }: Props) {
  const [step, setStep] = useState<'instructions' | 'uploading' | 'done'>('instructions')
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStep('uploading')
    setError(null)

    try {
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
      const { added, skipped } = await res.json()
      setResult({ added, skipped })
      setStep('done')
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import')
      setStep('instructions')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-[10vh] min-h-screen">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Import from Amazon</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'instructions' && (
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
                  <br />
                  Duplicate books (same title) are automatically skipped.
                </div>
              </div>

              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-amber-500/50 transition-colors cursor-pointer"
              >
                <svg className="w-8 h-8 mx-auto text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-500">Click to upload JSON files</p>
                <p className="text-xs text-slate-700 mt-1">or drag & drop</p>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".json"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />

              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center py-8">
              <div className="w-8 h-8 border-3 border-slate-600 border-t-amber-400 rounded-full animate-spin mb-4" />
              <p className="text-sm text-slate-400">Importing books...</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-6">
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-white font-medium">
                {result.added} book{result.added !== 1 ? 's' : ''} imported
              </p>
              {result.skipped > 0 && (
                <p className="text-sm text-slate-500 mt-1">
                  {result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped
                </p>
              )}
              <button
                onClick={onClose}
                className="mt-6 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl text-sm transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
