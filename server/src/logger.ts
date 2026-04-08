import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = resolve(__dirname, '../../data/logs.json')

export interface LogEntry {
  timestamp: string
  level: 'error' | 'warn' | 'info'
  source: string     // e.g. 'scraper', 'import', 'server'
  message: string
  details?: string   // stack trace, ISBN, book title, etc.
}

function readLogs(): LogEntry[] {
  if (!existsSync(LOG_PATH)) return []
  try {
    return JSON.parse(readFileSync(LOG_PATH, 'utf-8')) as LogEntry[]
  } catch {
    return []
  }
}

function writeLogs(logs: LogEntry[]) {
  writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2))
}

export function log(level: LogEntry['level'], source: string, message: string, details?: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    details,
  }
  const logs = readLogs()
  logs.push(entry)
  // Keep last 1000 entries
  if (logs.length > 1000) logs.splice(0, logs.length - 1000)
  writeLogs(logs)

  // Also print to console
  const prefix = level === 'error' ? '✗' : level === 'warn' ? '⚠' : 'ℹ'
  console.error(`${prefix} [${source}] ${message}${details ? ` — ${details.slice(0, 100)}` : ''}`)
}

export function getLogs(): LogEntry[] {
  return readLogs()
}

export function clearLogs() {
  writeLogs([])
}
