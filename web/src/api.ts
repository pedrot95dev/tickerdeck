export type Timeframe = 'D' | 'W' | 'M'
export const TIMEFRAMES: Timeframe[] = ['D', 'W', 'M']

export type SymbolInfo = {
  id: number
  source: 'tiingo' | 'binance'
  ticker: string
  status: 'pending' | 'ready' | 'error'
  error: string | null
  lastRefreshedAt: string | null
  /** Time of the intraday quote when the last candle is one, otherwise null. */
  quotedAt: string | null
}
export type WatchlistItem = {
  id: number
  symbol: SymbolInfo
  lastClose: number | null
  changePct: number | null
  lastDate: string | null
}
export type Watchlist = { id: number; name: string; items: WatchlistItem[] }
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number }
export type Line = { id: number; price: number }
/** A measured price range; the dates are daily candle dates. */
export type RangePoints = { fromDate: string; fromPrice: number; toDate: string; toPrice: number }
export type Range = RangePoints & { id: number }
export type MovingAverage = { type: 'SMA' | 'EMA'; period: number; enabled: boolean }
export type IndicatorSettings = {
  movingAverages: MovingAverage[]
  bollinger: { enabled: boolean; period: number; stdDev: number }
  volume: { enabled: boolean }
  rsi: { enabled: boolean; period: number }
  macd: { enabled: boolean; fast: number; slow: number; signal: number }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // The server rejects a JSON content-type on a request without a body.
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the server')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  getWatchlists: () => request<Watchlist[]>('GET', '/watchlists'),
  createWatchlist: (name: string) => request<Watchlist>('POST', '/watchlists', { name }),
  renameWatchlist: (id: number, name: string) => request<Watchlist>('PATCH', `/watchlists/${id}`, { name }),
  deleteWatchlist: (id: number) => request<void>('DELETE', `/watchlists/${id}`),
  addItems: (id: number, text: string) =>
    request<{ added: number; skipped: number }>('POST', `/watchlists/${id}/items`, { text }),
  removeItem: (id: number, itemId: number) => request<void>('DELETE', `/watchlists/${id}/items/${itemId}`),
  retrySymbol: (id: number) => request<void>('POST', `/symbols/${id}/retry`),
  getCandles: (id: number, tf: Timeframe) =>
    request<{ symbol: SymbolInfo; candles: Candle[] }>('GET', `/symbols/${id}/candles?tf=${tf}`),
  getLines: (id: number) => request<Line[]>('GET', `/symbols/${id}/lines`),
  addLine: (id: number, price: number) => request<Line>('POST', `/symbols/${id}/lines`, { price }),
  moveLine: (id: number, price: number) => request<Line>('PATCH', `/lines/${id}`, { price }),
  deleteLine: (id: number) => request<void>('DELETE', `/lines/${id}`),
  getRanges: (id: number) => request<Range[]>('GET', `/symbols/${id}/ranges`),
  addRange: (id: number, range: RangePoints) => request<Range>('POST', `/symbols/${id}/ranges`, range),
  deleteRange: (id: number) => request<void>('DELETE', `/ranges/${id}`),
  getSettings: () => request<IndicatorSettings>('GET', '/settings/indicators'),
  putSettings: (settings: IndicatorSettings) => request<IndicatorSettings>('PUT', '/settings/indicators', settings),
}
