import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'

// The schema as it was before quotes: no symbols.quoted_at, no candles.provisional.
const OLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS symbols(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT CHECK(source IN ('tiingo','binance')),
  ticker TEXT,
  status TEXT CHECK(status IN ('pending','ready','error')) DEFAULT 'pending',
  error TEXT NULL,
  last_refreshed_at TEXT NULL,
  UNIQUE(source, ticker));
CREATE TABLE IF NOT EXISTS candles(
  symbol_id INTEGER REFERENCES symbols ON DELETE CASCADE,
  date TEXT,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  split_factor REAL NOT NULL DEFAULT 1,
  PRIMARY KEY(symbol_id, date)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS watchlists(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS watchlist_items(
  id INTEGER PRIMARY KEY,
  watchlist_id INTEGER REFERENCES watchlists ON DELETE CASCADE,
  symbol_id INTEGER REFERENCES symbols,
  position INTEGER NOT NULL,
  UNIQUE(watchlist_id, symbol_id));
CREATE TABLE IF NOT EXISTS lines(
  id INTEGER PRIMARY KEY,
  symbol_id INTEGER REFERENCES symbols ON DELETE CASCADE,
  price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS ranges(
  id INTEGER PRIMARY KEY,
  symbol_id INTEGER REFERENCES symbols ON DELETE CASCADE,
  from_date TEXT NOT NULL, from_price REAL NOT NULL,
  to_date TEXT NOT NULL, to_price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tiingo_requests(at INTEGER NOT NULL);
`

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tickerdeck-test-'))
  path = join(dir, 'tickerdeck.db')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const columns = (db: Database.Database, table: string) =>
  (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)

test('a database created before quotes gets the new columns and keeps its rows', async () => {
  const old = new Database(path)
  old.exec(OLD_SCHEMA)
  old.exec(`
    INSERT INTO symbols(source, ticker, status, last_refreshed_at) VALUES ('tiingo', 'AAPL', 'ready', '2025-01-08T02:01:00.000Z');
    INSERT INTO candles(symbol_id, date, open, high, low, close, volume, split_factor) VALUES
      (1, '2025-01-06', 400, 410, 390, 400, 10, 1),
      (1, '2025-01-07', 100, 105, 95, 110, 20, 4);
    INSERT INTO watchlists(name, position) VALUES ('Main', 1);
    INSERT INTO watchlist_items(watchlist_id, symbol_id, position) VALUES (1, 1, 1);
    INSERT INTO lines(symbol_id, price) VALUES (1, 99.5);
    INSERT INTO tiingo_requests(at) VALUES (1736300000000);
  `)
  expect(columns(old, 'symbols')).not.toContain('quoted_at')
  expect(columns(old, 'candles')).not.toContain('provisional')
  old.close()

  let db = openDb(path)
  expect(columns(db, 'symbols')).toContain('quoted_at')
  expect(columns(db, 'candles')).toContain('provisional')
  expect(db.prepare('SELECT * FROM symbols').all()).toEqual([
    { id: 1, source: 'tiingo', ticker: 'AAPL', status: 'ready', error: null, last_refreshed_at: '2025-01-08T02:01:00.000Z', quoted_at: null },
  ])
  expect(db.prepare('SELECT date, close, split_factor, provisional FROM candles ORDER BY date').all()).toEqual([
    { date: '2025-01-06', close: 400, split_factor: 1, provisional: 0 },
    { date: '2025-01-07', close: 110, split_factor: 4, provisional: 0 },
  ])
  expect(db.prepare('SELECT COUNT(*) FROM lines').pluck().get()).toBe(1)
  expect(db.prepare('SELECT COUNT(*) FROM tiingo_requests').pluck().get()).toBe(1)

  const [list] = (await buildApp(db).inject({ url: '/api/watchlists' })).json()
  expect(list.items[0]).toMatchObject({ lastClose: 110, lastDate: '2025-01-07', symbol: { ticker: 'AAPL', quotedAt: null } })
  db.prepare("INSERT INTO candles(symbol_id, date, open, high, low, close, volume, provisional) VALUES (1, '2025-01-08', 1, 1, 1, 1, 1, 1)").run()
  db.close()

  // Opening it again changes nothing.
  db = openDb(path)
  expect(columns(db, 'candles').filter((c) => c === 'provisional')).toHaveLength(1)
  expect(db.prepare('SELECT COUNT(*) FROM candles').pluck().get()).toBe(3)
  db.close()
})

test('a new database has the same columns as a migrated one', () => {
  const old = new Database(path)
  old.exec(OLD_SCHEMA)
  old.close()
  const migrated = openDb(path)
  const fresh = openDb(':memory:')
  for (const table of ['symbols', 'candles']) expect(columns(fresh, table).sort()).toEqual(columns(migrated, table).sort())
  migrated.close()
})
