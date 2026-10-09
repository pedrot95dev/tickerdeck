import Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS symbols(
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- an id is never reused: in-flight downloads are keyed by it
  source TEXT CHECK(source IN ('tiingo','binance')),
  ticker TEXT,
  status TEXT CHECK(status IN ('pending','ready','error')) DEFAULT 'pending',
  error TEXT NULL,
  last_refreshed_at TEXT NULL,
  quoted_at TEXT NULL, -- time of the intraday quote behind the symbol's provisional candle
  UNIQUE(source, ticker));
CREATE TABLE IF NOT EXISTS candles(
  symbol_id INTEGER REFERENCES symbols ON DELETE CASCADE,
  date TEXT,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  split_factor REAL NOT NULL DEFAULT 1,
  provisional INTEGER NOT NULL DEFAULT 0, -- 1: an intraday quote, replaced by the end-of-day download
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

export type Db = Database.Database

/** For a database created before the column existed. */
function addColumn(db: Db, table: string, column: string, definition: string) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[]
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  addColumn(db, 'symbols', 'quoted_at', 'TEXT NULL')
  addColumn(db, 'candles', 'provisional', 'INTEGER NOT NULL DEFAULT 0')
  return db
}
