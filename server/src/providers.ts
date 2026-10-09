import type { CandleRow } from './candles.js'

export type Fetch = typeof fetch

/** A failure the user has to act on; its message is shown as the symbol's error. */
export class SymbolError extends Error {}
export class TokenError extends SymbolError {}
/** The request got no HTTP answer (network down, timeout), so the provider cannot have counted it. */
export class UnreachableError extends Error {}
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message)
  }
}

export const TOKEN_REJECTED = 'Tiingo rejected the token'

const TIMEOUT_MS = 20_000
const DAY_MS = 86_400_000

type TiingoRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  splitFactor: number
}

async function tiingoRows(fetch: Fetch, token: string, url: string): Promise<unknown[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new UnreachableError(err instanceof Error ? err.message : String(err))
  })
  if (res.status === 404) throw new SymbolError('Unknown ticker')
  if (res.status === 401 || res.status === 403) throw new TokenError(TOKEN_REJECTED)
  if (res.status === 429) throw new RateLimitedError('Tiingo rate limit reached')
  if (!res.ok) throw new Error(`Tiingo answered HTTP ${res.status}`)
  const body: unknown = await res.json()
  if (!Array.isArray(body)) throw new Error('Tiingo answered with an unexpected body')
  return body
}

/**
 * Daily candles from `startDate` ('YYYY-MM-DD', inclusive) to today.
 * Tiingo puts `splitFactor` on the day the split takes effect (4.0 for a 4:1 split, 1.0
 * otherwise) and that day's raw prices are already post-split, which is what `adjust` expects.
 */
export async function fetchTiingo(fetch: Fetch, token: string, ticker: string, startDate: string): Promise<CandleRow[]> {
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${startDate}&format=json`
  const body = await tiingoRows(fetch, token, url)
  return (body as TiingoRow[]).map((r) => ({
    date: r.date.slice(0, 10),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    split_factor: r.splitFactor,
  }))
}

export type Quote = {
  /** 'YYYY-MM-DD' of the session the quote belongs to. */
  date: string
  /** When the price was last updated, as Tiingo gives it. */
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const price = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

/** The running session of a stock from IEX; null when Tiingo has no usable one (before the open, unknown ticker). */
export async function fetchTiingoQuote(fetch: Fetch, token: string, ticker: string): Promise<Quote | null> {
  const [row] = (await tiingoRows(fetch, token, `https://api.tiingo.com/iex/?tickers=${encodeURIComponent(ticker)}`)) as (
    | Record<string, unknown>
    | null
    | undefined
  )[]
  const time = row?.timestamp
  const open = price(row?.open)
  const high = price(row?.high)
  const low = price(row?.low)
  const close = price(row?.tngoLast)
  if (typeof time !== 'string' || Number.isNaN(Date.parse(time)) || !open || !high || !low || !close) return null
  const volume = typeof row?.volume === 'number' && Number.isFinite(row.volume) ? row.volume : 0
  return { date: time.slice(0, 10), time, open, high, low, close, volume }
}

const BINANCE_PAGE = 1000

/** Daily candles from `startDate` ('YYYY-MM-DD', inclusive) to now; candle date = UTC date of the open time. */
export async function fetchBinance(fetch: Fetch, symbol: string, startDate: string): Promise<CandleRow[]> {
  const rows: CandleRow[] = []
  let startTime = Math.max(0, Date.parse(startDate)) // Binance rejects a negative startTime
  for (;;) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${BINANCE_PAGE}&startTime=${startTime}`
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 400) {
      const { code, msg } = (await res.json()) as { code: number; msg: string }
      // -1121 invalid symbol; -1100 illegal characters, which other parameters can raise too
      if (code === -1121 || (code === -1100 && msg.includes("'symbol'"))) throw new SymbolError('Unknown ticker')
    }
    if (res.status === 429 || res.status === 418) {
      const retryAfterMs = (Number(res.headers.get('retry-after')) || 0) * 1000
      throw new RateLimitedError(`Binance answered HTTP ${res.status}`, retryAfterMs)
    }
    if (!res.ok) throw new Error(`Binance answered HTTP ${res.status}`)
    const page = (await res.json()) as [number, string, string, string, string, string][]
    for (const k of page) {
      rows.push({
        date: new Date(k[0]).toISOString().slice(0, 10),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        split_factor: 1,
      })
    }
    if (page.length < BINANCE_PAGE) return rows
    startTime = page[page.length - 1][0] + DAY_MS
  }
}
