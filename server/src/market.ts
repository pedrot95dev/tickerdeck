import type { CandleRow } from './candles.js'
import type { Db } from './db.js'
import { createLimiter } from './limiter.js'
import {
  fetchBinance,
  fetchTiingo,
  RateLimitedError,
  SymbolError,
  TOKEN_REJECTED,
  TokenError,
  UnreachableError,
  type Fetch,
} from './providers.js'

type SymbolRow = {
  id: number
  source: 'tiingo' | 'binance'
  ticker: string
  status: 'pending' | 'ready' | 'error'
  last_refreshed_at: string | null
}

export type Market = ReturnType<typeof createMarket>

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const FULL_HISTORY = '1900-01-01'
// 02:00 UTC on the day after the trading day: Tiingo has published the day by then, summer and winter.
const STOCKS_CUTOFF_MS = 26 * HOUR
const STOCKS_RETRY_MS = 6 * HOUR
const STOCKS_RETRY_WINDOW_MS = 24 * HOUR
const CRYPTO_REFRESH_MS = 15 * MINUTE
const CRYPTO_STALE_MS = MINUTE
const RATE_LIMIT_BACKOFF_MS = 15 * MINUTE
const FAILURE_BACKOFF_MS = MINUTE
const MAX_SYMBOL_BACKOFF_MS = HOUR
const MAX_PENDING_FAILURES = 5
const TOKEN_MISSING = 'Tiingo token not configured'

/** The most recent weekday D such that 02:00 UTC on D+1 has passed, as 'YYYY-MM-DD'. */
export function stocksDueDay(now: number): string {
  const d = new Date(now - STOCKS_CUTOFF_MS)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** `now` returns epoch milliseconds. */
export function createMarket(
  db: Db,
  opts: { fetch: Fetch; now: () => number; token?: string; log: (message: string) => void },
) {
  const { fetch, now, token, log } = opts
  const limiter = createLimiter(db, now, 45, 900)
  const inFlight = new Map<number, Promise<void>>()
  /** `successes` is the provider's success count when the symbol last failed. */
  const backoff = new Map<number, { failures: number; retryAt: number; successes: number }>()
  const successes = { tiingo: 0, binance: 0 }
  let binancePausedUntil = 0
  let nextCryptoRefresh = 0
  let ticking = false

  const lastDate = db.prepare('SELECT MAX(date) FROM candles WHERE symbol_id = ?').pluck()
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO candles(symbol_id, date, open, high, low, close, volume, split_factor)
     VALUES (@id, @date, @open, @high, @low, @close, @volume, @split_factor)`,
  )
  const markReady = db.prepare("UPDATE symbols SET status = 'ready', error = NULL, last_refreshed_at = ? WHERE id = ?")
  const markError = db.prepare("UPDATE symbols SET status = 'error', error = ? WHERE id = ?")
  const markPendingStocksError = db.prepare(
    "UPDATE symbols SET status = 'error', error = ? WHERE source = 'tiingo' AND status = 'pending'",
  )
  const exists = db.prepare('SELECT 1 FROM symbols WHERE id = ?').pluck()

  // Startup with a token: stocks that failed only for the lack of a working one get another go.
  if (token) {
    db.prepare(
      "UPDATE symbols SET status = 'pending', error = NULL WHERE source = 'tiingo' AND status = 'error' AND error IN (?, ?)",
    ).run(TOKEN_MISSING, TOKEN_REJECTED)
  }

  const store = db.transaction((id: number, rows: CandleRow[]) => {
    if (!exists.get(id)) return // removed from every watchlist while downloading
    for (const row of rows) upsert.run({ id, ...row })
    markReady.run(new Date(now()).toISOString(), id)
  })

  /** Full history when nothing is stored, otherwise from the last stored date (inclusive). */
  async function download(s: SymbolRow): Promise<void> {
    const start = (lastDate.get(s.id) as string | null) ?? FULL_HISTORY
    const rows =
      s.source === 'binance'
        ? await fetchBinance(fetch, s.ticker, start)
        : await fetchTiingo(fetch, token as string, s.ticker, start)
    if (!rows.length && start === FULL_HISTORY) throw new SymbolError('No price data')
    store(s.id, rows)
  }

  function pauseProvider(source: SymbolRow['source'], ms: number) {
    if (source === 'tiingo') limiter.pause(ms)
    else binancePausedUntil = Math.max(binancePausedUntil, now() + ms)
  }

  const retryAt = (s: SymbolRow) => backoff.get(s.id)?.retryAt ?? 0
  const blocked = (s: SymbolRow) => (s.source === 'binance' && now() < binancePausedUntil) || now() < retryAt(s)

  async function attempt(s: SymbolRow): Promise<void> {
    if (blocked(s) || (s.source === 'tiingo' && !limiter.tryAcquire())) return
    try {
      await download(s)
      backoff.delete(s.id)
      successes[s.source]++
    } catch (err) {
      log(`Download failed for ${s.source}:${s.ticker}: ${message(err)}`)
      if (err instanceof UnreachableError) limiter.release()
      if (err instanceof RateLimitedError) {
        // The provider's fault, not the symbol's: it waits out the pause and is never dropped.
        pauseProvider(s.source, Math.max(RATE_LIMIT_BACKOFF_MS, err.retryAfterMs))
        return
      }
      if (err instanceof TokenError) {
        pauseProvider(s.source, RATE_LIMIT_BACKOFF_MS)
        markPendingStocksError.run(message(err)) // none of them can download either
      } else if (!(err instanceof SymbolError)) pauseProvider(s.source, FAILURE_BACKOFF_MS)

      const previous = backoff.get(s.id)
      // A repeated failure is the symbol's fault only if the provider is known to be up: it answered about
      // this symbol, or has served another one since. Otherwise it may be an outage and is not counted.
      const counted = !previous || err instanceof SymbolError || successes[s.source] > previous.successes
      const failures = (previous?.failures ?? 0) + (counted ? 1 : 0)
      // A ready symbol keeps its stored data; a pending one becomes an error the user can retry.
      if (s.status === 'pending' && (err instanceof SymbolError || failures >= MAX_PENDING_FAILURES)) {
        markError.run(message(err), s.id)
        backoff.delete(s.id)
      } else {
        const wait = Math.min(FAILURE_BACKOFF_MS * 2 ** (failures - 1), MAX_SYMBOL_BACKOFF_MS)
        backoff.set(s.id, { failures, retryAt: now() + wait, successes: successes[s.source] })
      }
    }
  }

  async function runJobs(): Promise<void> {
    const queue: SymbolRow[] = []
    const pending = db.prepare("SELECT * FROM symbols WHERE status = 'pending' ORDER BY id").all() as SymbolRow[]
    for (const s of pending) {
      if (s.source === 'tiingo' && !token) markError.run(TOKEN_MISSING, s.id)
      else queue.push(s)
    }

    if (token) {
      const day = stocksDueDay(now())
      const cutoff = Date.parse(day) + STOCKS_CUTOFF_MS
      // Not refreshed since the day's cut-off (a candle stored before it may be provisional), or, during the
      // 24 hours after it, refreshed over 6 hours ago without getting the day (late publication, holiday).
      const due = db
        .prepare(
          `SELECT * FROM symbols s WHERE source = 'tiingo' AND status = 'ready' AND (last_refreshed_at < ?
           OR (? AND last_refreshed_at < ? AND (SELECT MAX(date) FROM candles WHERE symbol_id = s.id) < ?)) ORDER BY id`,
        )
        .all(
          new Date(cutoff).toISOString(),
          now() < cutoff + STOCKS_RETRY_WINDOW_MS ? 1 : 0,
          new Date(now() - STOCKS_RETRY_MS).toISOString(),
          day,
        ) as SymbolRow[]
      queue.push(...due)
    }

    const cryptoRefresh = now() >= nextCryptoRefresh
    if (cryptoRefresh) {
      nextCryptoRefresh = now() + CRYPTO_REFRESH_MS
      const ready = db
        .prepare("SELECT * FROM symbols WHERE source = 'binance' AND status = 'ready' ORDER BY id")
        .all() as SymbolRow[]
      queue.push(...ready)
    }

    // The symbol that failed longest ago (or never) goes first, so one that keeps failing cannot hold back the rest.
    queue.sort((a, b) => retryAt(a) - retryAt(b))
    for (const s of queue) await attempt(s)
    if (cryptoRefresh && now() < binancePausedUntil) nextCryptoRefresh = binancePausedUntil
  }

  return {
    /** One pass over the pending queue and both refresh schedules. Call it on a short interval. */
    async tick(): Promise<void> {
      if (ticking) return
      ticking = true
      try {
        await runJobs()
      } catch (err) {
        log(`Market data job failed: ${message(err)}`)
      } finally {
        ticking = false
      }
    },

    /** Refreshes a ready Binance symbol whose last refresh is more than 60 s old. */
    async refreshIfStale(symbolId: number): Promise<void> {
      const s = db.prepare('SELECT * FROM symbols WHERE id = ?').get(symbolId) as SymbolRow | undefined
      if (!s || s.source !== 'binance' || s.status !== 'ready') return
      if (now() - Date.parse(s.last_refreshed_at as string) <= CRYPTO_STALE_MS || blocked(s)) return
      let running = inFlight.get(s.id)
      if (!running) {
        running = attempt(s).finally(() => inFlight.delete(s.id))
        inFlight.set(s.id, running)
      }
      await running
    },
  }
}
