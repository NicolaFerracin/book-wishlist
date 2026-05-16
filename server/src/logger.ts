import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '../../data')
const DB_PATH = resolve(DATA_DIR, 'book-wishlist.sqlite')
const LEGACY_LOG_PATH = resolve(DATA_DIR, 'logs.json')

mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

export interface LogEntry {
  timestamp: string
  level: 'error' | 'warn' | 'info'
  source: string
  message: string
  details?: string
}

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
`)

const logCount = db.prepare('SELECT COUNT(*) AS count FROM logs').get() as { count: number }
if (logCount.count === 0 && existsSync(LEGACY_LOG_PATH)) {
  try {
    const logs = JSON.parse(readFileSync(LEGACY_LOG_PATH, 'utf-8')) as LogEntry[]
    const insert = db.prepare(`
      INSERT INTO logs (timestamp, level, source, message, details)
      VALUES (@timestamp, @level, @source, @message, @details)
    `)
    const migrate = db.transaction((entries: LogEntry[]) => {
      for (const entry of entries) insert.run({ ...entry, details: entry.details ?? null })
    })
    migrate(logs)
    console.log(`Migrated ${logs.length} logs from data/logs.json to data/book-wishlist.sqlite`)
  } catch (e) {
    console.error(`Failed to migrate data/logs.json: ${(e as Error).message}`)
  }
}

export function log(level: LogEntry['level'], source: string, message: string, details?: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    details,
  }

  db.prepare(`
    INSERT INTO logs (timestamp, level, source, message, details)
    VALUES (@timestamp, @level, @source, @message, @details)
  `).run({ ...entry, details: details ?? null })

  const count = db.prepare('SELECT COUNT(*) AS count FROM logs').get() as { count: number }
  if (count.count > 1000) {
    db.prepare(`
      DELETE FROM logs
      WHERE id IN (
        SELECT id FROM logs ORDER BY timestamp ASC, id ASC LIMIT @limit
      )
    `).run({ limit: count.count - 1000 })
  }

  const prefix = level === 'error' ? 'x' : level === 'warn' ? '!' : 'i'
  console.error(`${prefix} [${source}] ${message}${details ? ` - ${details.slice(0, 100)}` : ''}`)
}

export function getLogs(): LogEntry[] {
  return db.prepare(`
    SELECT timestamp, level, source, message, details
    FROM logs
    ORDER BY timestamp DESC, id DESC
    LIMIT 1000
  `).all() as LogEntry[]
}

export function clearLogs() {
  db.prepare('DELETE FROM logs').run()
}
