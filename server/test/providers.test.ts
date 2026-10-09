import { expect, test } from 'vitest'
import { adjust } from '../src/candles.js'
import {
  fetchBinance,
  fetchTiingo,
  fetchTiingoQuote,
  RateLimitedError,
  SymbolError,
  TokenError,
  UnreachableError,
} from '../src/providers.js'
import { fakeFetch } from './fake-fetch.js'

// Shape of Tiingo's end-of-day rows; AAPL around its 4:1 split of 2020-08-31.
const tiingoRow = (date: string, close: number, volume: number, splitFactor = 1) => ({
  date: `${date}T00:00:00.000Z`,
  open: close - 1,
  high: close + 2,
  low: close - 3,
  close,
  volume,
  adjClose: 0,
  adjHigh: 0,
  adjLow: 0,
  adjOpen: 0,
  adjVolume: 0,
  divCash: 0,
  splitFactor,
})

test('Tiingo: requests the daily prices with the token in the Authorization header only', async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: [] }))
  await fetchTiingo(fetch, 'secret-token', 'BRK-B', '2025-01-02')
  expect(calls).toEqual([
    {
      url: 'https://api.tiingo.com/tiingo/daily/BRK-B/prices?startDate=2025-01-02&format=json',
      headers: { Authorization: 'Token secret-token', 'Content-Type': 'application/json' },
    },
  ])
})

test('Tiingo: parses raw rows, and a split row makes adjust() restate the earlier prices', async () => {
  const { fetch } = fakeFetch(() => ({
    body: [
      tiingoRow('2020-08-27', 500, 100),
      tiingoRow('2020-08-28', 499.2, 200),
      tiingoRow('2020-08-31', 129, 900, 4),
      tiingoRow('2020-09-01', 134, 800),
    ],
  }))
  const rows = await fetchTiingo(fetch, 't', 'AAPL', '1900-01-01')
  expect(rows[2]).toEqual({ date: '2020-08-31', open: 128, high: 131, low: 126, close: 129, volume: 900, split_factor: 4 })
  expect(rows.map((r) => r.split_factor)).toEqual([1, 1, 4, 1])

  const adjusted = adjust(rows)
  expect(adjusted.map((c) => c.close)).toEqual([125, 124.8, 129, 134])
  expect(adjusted.map((c) => c.volume)).toEqual([400, 800, 900, 800])
})

test('Tiingo: 404 is an unknown ticker, 429 a rate limit, other failures plain errors', async () => {
  const status = (code: number) => fetchTiingo(fakeFetch(() => ({ status: code, body: { detail: 'x' } })).fetch, 't', 'X', '1900-01-01')
  const unknown = await status(404).catch((e) => e)
  expect(unknown).toBeInstanceOf(SymbolError)
  expect(unknown.message).toBe('Unknown ticker')
  expect(await status(401).catch((e) => e)).toBeInstanceOf(SymbolError)
  expect(await status(429).catch((e) => e)).toBeInstanceOf(RateLimitedError)
  const server = await status(500).catch((e) => e)
  expect(server).not.toBeInstanceOf(SymbolError)
  expect(server).not.toBeInstanceOf(RateLimitedError)
  expect(server.message).toBe('Tiingo answered HTTP 500')
})

// Shape of Tiingo's IEX answer on the free plan.
const iexRow = {
  ticker: 'AAPL',
  timestamp: '2026-10-08T20:00:00+00:00',
  lastSaleTimestamp: '2026-10-08T20:00:00+00:00',
  quoteTimestamp: '2026-10-08T20:00:00+00:00',
  open: 336.815,
  high: 341.57,
  low: 335.9,
  mid: null,
  tngoLast: 340.42,
  last: null,
  lastSize: null,
  bidSize: null,
  bidPrice: null,
  askPrice: null,
  askSize: null,
  volume: 35332449,
  prevClose: 336.67,
}

test('Tiingo quote: requests the IEX quote with the token in the Authorization header only', async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: [iexRow] }))
  await fetchTiingoQuote(fetch, 'secret-token', 'BRK-B')
  expect(calls).toEqual([
    {
      url: 'https://api.tiingo.com/iex/?tickers=BRK-B',
      headers: { Authorization: 'Token secret-token', 'Content-Type': 'application/json' },
    },
  ])
})

test('Tiingo quote: the last price is the close and the date is the day of the timestamp', async () => {
  const quote = (row: unknown) => fetchTiingoQuote(fakeFetch(() => ({ body: [row] })).fetch, 't', 'AAPL')
  expect(await quote(iexRow)).toEqual({
    date: '2026-10-08',
    time: '2026-10-08T20:00:00+00:00',
    open: 336.815,
    high: 341.57,
    low: 335.9,
    close: 340.42,
    volume: 35332449,
  })
  expect(await quote({ ...iexRow, timestamp: '2026-10-08T15:59:58.123-04:00' })).toMatchObject({
    date: '2026-10-08',
    time: '2026-10-08T15:59:58.123-04:00',
  })
  expect(await quote({ ...iexRow, volume: null })).toMatchObject({ close: 340.42, volume: 0 })
})

test('Tiingo quote: no quote when the answer is empty or a needed field is missing or not a positive number', async () => {
  const quote = (body: unknown) => fetchTiingoQuote(fakeFetch(() => ({ body })).fetch, 't', 'AAPL')
  expect(await quote([])).toBeNull()
  expect(await quote([null])).toBeNull()
  for (const field of ['timestamp', 'open', 'high', 'low', 'tngoLast']) {
    for (const value of [null, undefined, 0, -1, '340.42']) {
      const row = { ...iexRow, [field]: value }
      if (field === 'timestamp' && value === '340.42') continue
      expect(await quote([row]), `${field}=${value}`).toBeNull()
    }
  }
  expect(await quote([{ ...iexRow, timestamp: 'soon' }])).toBeNull()
})

test('Tiingo quote: fails with the same error classes as the daily download', async () => {
  const status = (code: number) => fetchTiingoQuote(fakeFetch(() => ({ status: code, body: {} })).fetch, 't', 'X')
  expect(await status(404).catch((e) => e)).toBeInstanceOf(SymbolError)
  expect(await status(401).catch((e) => e)).toBeInstanceOf(TokenError)
  expect(await status(403).catch((e) => e)).toBeInstanceOf(TokenError)
  expect(await status(429).catch((e) => e)).toBeInstanceOf(RateLimitedError)
  expect((await status(500).catch((e) => e)).message).toBe('Tiingo answered HTTP 500')
  const offline = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  expect(await fetchTiingoQuote(offline, 't', 'X').catch((e) => e)).toBeInstanceOf(UnreachableError)
  const notAList = fetchTiingoQuote(fakeFetch(() => ({ body: { detail: 'x' } })).fetch, 't', 'X')
  expect((await notAList.catch((e) => e)).message).toBe('Tiingo answered with an unexpected body')
})

const DAY = 86_400_000
const kline = (openTime: number, close: number) => [
  openTime,
  String(close - 1),
  String(close + 2),
  String(close - 3),
  String(close),
  '12.5',
  openTime + DAY - 1,
  '0',
  1,
  '0',
  '0',
  '0',
]

test('Binance: pages with startTime across more than 1000 candles', async () => {
  const first = Date.parse('2017-08-17')
  const total = 2300
  const { fetch, calls } = fakeFetch((url) => {
    const from = Math.max(0, Math.ceil((Number(url.searchParams.get('startTime')) - first) / DAY))
    const page = []
    for (let i = from; i < Math.min(from + 1000, total); i++) page.push(kline(first + i * DAY, 100 + i))
    return { body: page }
  })

  const rows = await fetchBinance(fetch, 'BTCUSDT', '1900-01-01')

  expect(calls.map((c) => new URL(c.url).searchParams.get('startTime'))).toEqual([
    '0',
    String(first + 1000 * DAY),
    String(first + 2000 * DAY),
  ])
  expect(calls[0].url).toBe(
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&startTime=0',
  )
  expect(rows).toHaveLength(total)
  expect(new Set(rows.map((r) => r.date)).size).toBe(total)
  expect(rows[0]).toEqual({ date: '2017-08-17', open: 99, high: 102, low: 97, close: 100, volume: 12.5, split_factor: 1 })
  expect(rows[total - 1].date).toBe(new Date(first + (total - 1) * DAY).toISOString().slice(0, 10))
})

test('Binance: a full last page is followed by one empty page', async () => {
  const first = Date.parse('2020-01-01')
  const { fetch, calls } = fakeFetch((url) => {
    const start = Number(url.searchParams.get('startTime'))
    return { body: start <= first ? Array.from({ length: 1000 }, (_, i) => kline(first + i * DAY, 5)) : [] }
  })
  expect(await fetchBinance(fetch, 'SOLUSDT', '2020-01-01')).toHaveLength(1000)
  expect(calls).toHaveLength(2)
})

test('Binance: an invalid symbol is an unknown ticker, other failures plain errors', async () => {
  const invalid = fakeFetch(() => ({ status: 400, body: { code: -1121, msg: 'Invalid symbol.' } }))
  const unknown = await fetchBinance(invalid.fetch, 'NOPEUSDT', '1900-01-01').catch((e) => e)
  expect(unknown).toBeInstanceOf(SymbolError)
  expect(unknown.message).toBe('Unknown ticker')

  const illegal = fakeFetch(() => ({
    status: 400,
    body: { code: -1100, msg: "Illegal characters found in parameter 'symbol'; legal range is '^[\w\-._&&[^a-z]]{1,50}$'." },
  }))
  expect(await fetchBinance(illegal.fetch, 'A&BUSDT', '1900-01-01').catch((e) => e)).toBeInstanceOf(SymbolError)

  const badRequest = fakeFetch(() => ({
    status: 400,
    body: { code: -1100, msg: "Illegal characters found in parameter 'startTime'; legal range is '^[0-9]{1,20}$'." },
  }))
  const other = await fetchBinance(badRequest.fetch, 'BTCUSDT', '1900-01-01').catch((e) => e)
  expect(other).not.toBeInstanceOf(SymbolError)
  expect(other.message).toBe('Binance answered HTTP 400')
})
