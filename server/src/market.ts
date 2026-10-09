import type { CandleRow } from './candles.js'
import type { Db } from './db.js'
import { createLimiter } from './limiter.js'
import {
  fetchBinance,
  fetchTiingo,
  fetchTiingoQuote,
  RateLimitedError,
  SymbolError,
  TOKEN_REJECTED,
  TokenError,
  UnreachableError,
  type Fetch,
  type Quote,
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
// While a browser has the app open: every other 5-second tick, with room for timer jitter.
const CRYPTO_LIVE_REFRESH_MS = 9_500
const CLIENT_ACTIVE_MS = MINUTE
const CRYPTO_STALE_MS = MINUTE
const QUOTE_INTERVAL_MS = MINUTE
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

/** Monday to Friday, 12:00 to 22:00 UTC: the US session in summer and winter time, with a margin. */
export function quoteHours(now: number): boolean {
  const d = new Date(now)
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getUTCHours() >= 12 && d.getUTCHours() < 22
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
  const quoteAttempts = new Map<number, number>()
  /** `successes` is the provider's success count when the symbol last failed. */
  const backoff = new Map<number, { failures: number; retryAt: number; successes: number }>()
  const successes = { tiingo: 0, binance: 0 }
  let binancePausedUntil = 0
  let nextCryptoRefresh = 0
  let lastCryptoRefresh = -Infinity
  let lastClientAt = -Infinity
  let ticking = false

  // A provisional candle does not count: the download starts at the last official day and replaces it.
  const lastDate = db.prepare('SELECT MAX(date) FROM candles WHERE symbol_id = ? AND provisional = 0').pluck()
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
  // Only for a day after the last official candle: an official candle is never replaced (it holds the split
  // factor), and a quote left over from an earlier session is not a new day.
  const upsertQuote = db.prepare(
    `INSERT OR REPLACE INTO candles(symbol_id, date, open, high, low, close, volume, split_factor, provisional)
     SELECT @id, @date, @open, @high, @low, @close, @volume, 1, 1
     WHERE @date > COALESCE((SELECT MAX(date) FROM candles WHERE symbol_id = @id AND provisional = 0), '')`,
  )
  // A quote for a day the provider never publishes (a holiday) would otherwise stay in the history for good.
  const dropSkippedQuotes = db.prepare(
    `DELETE FROM candles WHERE symbol_id = @id AND provisional = 1
     AND date < (SELECT MAX(date) FROM candles WHERE symbol_id = @id AND provisional = 0)`,
  )
  const markQuoted = db.prepare('UPDATE symbols SET quoted_at = ? WHERE id = ?')
  const clearQuoted = db.prepare(
    'UPDATE symbols SET quoted_at = NULL WHERE id = @id AND NOT EXISTS (SELECT 1 FROM candles WHERE symbol_id = @id AND provisional = 1)',
  )

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
    dropSkippedQuotes.run({ id })
    clearQuoted.run({ id })
  })

  const storeQuote = db.transaction((id: number, { time, ...candle }: Quote) => {
    if (!exists.get(id)) return
    if (upsertQuote.run({ id, ...candle }).changes) markQuoted.run(time, id)
  })

  /** Full history when nothing is stored, otherwise from the last official date (inclusive). */
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

  /** Never touches the symbol's status, its back-off or `last_refreshed_at`: the end-of-day refresh is unaffected. */
  async function quote(s: SymbolRow): Promise<void> {
    try {
      const q = await fetchTiingoQuote(fetch, token as string, s.ticker)
      if (q) storeQuote(s.id, q)
    } catch (err) {
      log(`Quote failed for ${s.source}:${s.ticker}: ${message(err)}`)
      if (err instanceof UnreachableError) limiter.release()
      if (err instanceof RateLimitedError) pauseProvider(s.source, Math.max(RATE_LIMIT_BACKOFF_MS, err.retryAfterMs))
      else if (err instanceof TokenError) pauseProvider(s.source, RATE_LIMIT_BACKOFF_MS)
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
           OR (? AND last_refreshed_at < ? AND (SELECT MAX(date) FROM candles WHERE symbol_id = s.id AND provisional = 0) < ?)) ORDER BY id`,
        )
        .all(
          new Date(cutoff).toISOString(),
          now() < cutoff + STOCKS_RETRY_WINDOW_MS ? 1 : 0,
          new Date(now() - STOCKS_RETRY_MS).toISOString(),
          day,
        ) as SymbolRow[]
      queue.push(...due)
    }

    const live = now() - lastClientAt <= CLIENT_ACTIVE_MS && now() - lastCryptoRefresh >= CRYPTO_LIVE_REFRESH_MS
    const cryptoRefresh = live || now() >= nextCryptoRefresh
    if (cryptoRefresh) {
      lastCryptoRefresh = now()
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

    /** A browser has the app open: crypto is refreshed every 10 s for the next minute. */
    clientSeen() {
      lastClientAt = now()
    },

    /**
     * For a ready symbol that is being read. Binance: refreshes it when its last refresh is more than 60 s old.
     * Tiingo: during US market hours, stores a quote as the day's provisional candle, at most once every 60 s.
     */
    async refreshIfStale(symbolId: number): Promise<void> {
      const s = db.prepare('SELECT * FROM symbols WHERE id = ?').get(symbolId) as SymbolRow | undefined
      if (!s || s.status !== 'ready') return
      let running = inFlight.get(s.id)
      if (!running) {
        if (blocked(s)) return
        if (s.source === 'binance') {
          if (now() - Date.parse(s.last_refreshed_at as string) <= CRYPTO_STALE_MS) return
          running = attempt(s)
        } else {
          if (!token || !quoteHours(now())) return
          if (now() - (quoteAttempts.get(s.id) ?? -Infinity) <= QUOTE_INTERVAL_MS || !limiter.tryAcquire()) return
          quoteAttempts.set(s.id, now())
          running = quote(s)
        }
        running = running.finally(() => inFlight.delete(s.id))
        inFlight.set(s.id, running)
      }
      await running
    },
  }
}
