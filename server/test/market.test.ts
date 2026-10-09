import { beforeEach, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb, type Db } from '../src/db.js'
import { createMarket, stocksDueDay } from '../src/market.js'
import { fakeFetch } from './fake-fetch.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 86_400_000
const TOKEN = 'secret-token'
const at = (iso: string) => Date.parse(iso)

let db: Db
let now: number
let logs: string[]

beforeEach(() => {
  db = openDb(':memory:')
  now = at('2025-01-08T12:00:00Z') // a Wednesday
  logs = []
})

type Respond = Parameters<typeof fakeFetch>[0]

function setup(respond: Respond, token: string | null = TOKEN) {
  const { fetch, calls } = fakeFetch(respond)
  const market = createMarket(db, { fetch, now: () => now, token: token ?? undefined, log: (m) => logs.push(m) })
  return { market, calls }
}

function addSymbol(source: 'tiingo' | 'binance', ticker: string, readyAt?: string): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO symbols(source, ticker, status, last_refreshed_at) VALUES (?, ?, ?, ?)')
    .run(source, ticker, readyAt ? 'ready' : 'pending', readyAt ? new Date(at(readyAt)).toISOString() : null)
  return Number(lastInsertRowid)
}

function addCandle(symbolId: number, date: string, close: number) {
  db.prepare('INSERT INTO candles(symbol_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, 1)').run(
    symbolId,
    date,
    close,
    close,
    close,
    close,
  )
}

const symbol = (id: number) =>
  db.prepare('SELECT status, error, last_refreshed_at FROM symbols WHERE id = ?').get(id) as {
    status: string
    error: string | null
    last_refreshed_at: string | null
  }
const closes = (id: number) =>
  db.prepare('SELECT date, close FROM candles WHERE symbol_id = ? ORDER BY date').all(id) as {
    date: string
    close: number
  }[]

const tiingoRow = (date: string, close: number, splitFactor = 1) => ({
  date: `${date}T00:00:00.000Z`,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  splitFactor,
})
const kline = (date: string, close: number) => [at(date), `${close}`, `${close}`, `${close}`, `${close}`, '10']
const startDate = (call: { url: string }) => new URL(call.url).searchParams.get('startDate')

// --- pending queue ---

test('pending Tiingo symbol: one full-history request, then ready', async () => {
  const id = addSymbol('tiingo', 'AAPL')
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-06', 10), tiingoRow('2025-01-07', 11)] }))

  await market.tick()

  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe('https://api.tiingo.com/tiingo/daily/AAPL/prices?startDate=1900-01-01&format=json')
  expect(symbol(id)).toEqual({ status: 'ready', error: null, last_refreshed_at: '2025-01-08T12:00:00.000Z' })
  expect(closes(id)).toEqual([
    { date: '2025-01-06', close: 10 },
    { date: '2025-01-07', close: 11 },
  ])
  await market.tick()
  expect(calls).toHaveLength(1)
})

test('a split row is stored with its factor', async () => {
  const id = addSymbol('tiingo', 'AAPL')
  const { market } = setup(() => ({ body: [tiingoRow('2025-01-06', 400), tiingoRow('2025-01-07', 100, 4)] }))
  await market.tick()
  expect(db.prepare('SELECT split_factor FROM candles WHERE symbol_id = ? ORDER BY date').pluck().all(id)).toEqual([1, 4])
})

test('missing token: Tiingo symbols become errors without any request', async () => {
  const id = addSymbol('tiingo', 'AAPL')
  const { market, calls } = setup(() => ({ body: [] }), null)
  await market.tick()
  expect(calls).toHaveLength(0)
  expect(symbol(id)).toEqual({ status: 'error', error: 'Tiingo token not configured', last_refreshed_at: null })
})

test('unknown Tiingo ticker becomes an error and is not requested again', async () => {
  const id = addSymbol('tiingo', 'NOPE')
  const { market, calls } = setup(() => ({ status: 404, body: { detail: 'Not found.' } }))
  await market.tick()
  await market.tick()
  expect(calls).toHaveLength(1)
  expect(symbol(id)).toMatchObject({ status: 'error', error: 'Unknown ticker' })
})

test('HTTP 429 leaves the symbol pending and it is retried after the back-off', async () => {
  const a = addSymbol('tiingo', 'AAPL')
  const b = addSymbol('tiingo', 'MSFT')
  let limited = true
  const { market, calls } = setup(() => (limited ? { status: 429, body: {} } : { body: [tiingoRow('2025-01-07', 5)] }))

  await market.tick()
  expect(calls).toHaveLength(1) // the back-off also holds back the second symbol
  expect(symbol(a)).toEqual({ status: 'pending', error: null, last_refreshed_at: null })
  expect(symbol(b).status).toBe('pending')

  limited = false
  now += 15 * MINUTE - 1
  await market.tick()
  expect(calls).toHaveLength(1)

  now += 1
  await market.tick()
  expect(calls).toHaveLength(3)
  expect(symbol(a).status).toBe('ready')
  expect(symbol(b).status).toBe('ready')
})

test('a transient Tiingo failure leaves the symbol pending', async () => {
  const id = addSymbol('tiingo', 'AAPL')
  let down = true
  const { market } = setup(() => (down ? { status: 503, body: {} } : { body: [tiingoRow('2025-01-07', 5)] }))
  await market.tick()
  expect(symbol(id).status).toBe('pending')
  down = false
  now += MINUTE
  await market.tick()
  expect(symbol(id).status).toBe('ready')
})

test('Tiingo downloads go at limiter pace: 45 per hour', async () => {
  for (let i = 0; i < 46; i++) addSymbol('tiingo', `T${i}`)
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-07', 5)] }))
  const pending = () => db.prepare("SELECT COUNT(*) FROM symbols WHERE status = 'pending'").pluck().get()

  await market.tick()
  await market.tick()
  expect(calls).toHaveLength(45)
  expect(pending()).toBe(1)

  now += 60 * MINUTE
  await market.tick()
  expect(calls).toHaveLength(46)
  expect(pending()).toBe(0)
})

test('pending Binance symbol: full history, ready; unknown symbol becomes an error', async () => {
  const btc = addSymbol('binance', 'BTCUSDT')
  const nope = addSymbol('binance', 'NOPEUSDT')
  const { market, calls } = setup((url) =>
    url.searchParams.get('symbol') === 'BTCUSDT'
      ? { body: [kline('2025-01-07', 100), kline('2025-01-08', 101)] }
      : { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } },
  )

  await market.tick()

  expect(new URL(calls[0].url).searchParams.get('startTime')).toBe('0')
  expect(symbol(btc)).toEqual({ status: 'ready', error: null, last_refreshed_at: '2025-01-08T12:00:00.000Z' })
  expect(closes(btc)).toEqual([
    { date: '2025-01-07', close: 100 },
    { date: '2025-01-08', close: 101 },
  ])
  expect(symbol(nope)).toEqual({ status: 'error', error: 'Unknown ticker', last_refreshed_at: null })
})

test('a transient Binance failure leaves the symbol pending and it is retried a minute later', async () => {
  const id = addSymbol('binance', 'BTCUSDT')
  let down = true
  const { market } = setup(() => (down ? { status: 500, body: {} } : { body: [kline('2025-01-08', 101)] }))
  await market.tick()
  expect(symbol(id).status).toBe('pending')
  down = false
  now += MINUTE
  await market.tick()
  expect(symbol(id).status).toBe('ready')
})

test('a symbol removed during its download is not stored', async () => {
  const id = addSymbol('binance', 'BTCUSDT')
  const { market } = setup(() => {
    db.prepare('DELETE FROM symbols WHERE id = ?').run(id)
    return { body: [kline('2025-01-08', 101)] }
  })
  await market.tick()
  expect(db.prepare('SELECT COUNT(*) FROM candles').pluck().get()).toBe(0)
  expect(logs).toEqual([])
})

test.each([
  ['candles', { body: [kline('2025-01-08', 101)] }],
  ['an unknown-ticker answer', { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } }],
])('a symbol added while a removed one was downloading gets none of its result: %s', async (_name, answer) => {
  const btc = addSymbol('binance', 'BTCUSDT')
  let eth = 0
  const { market } = setup(() => {
    db.prepare('DELETE FROM symbols WHERE id = ?').run(btc)
    eth = addSymbol('binance', 'ETHUSDT')
    return answer
  })

  await market.tick()

  expect(eth).not.toBe(btc)
  expect(symbol(eth)).toEqual({ status: 'pending', error: null, last_refreshed_at: null })
  expect(db.prepare('SELECT COUNT(*) FROM candles').pluck().get()).toBe(0)
})

// --- back-off ---

test.each([
  [
    'tiingo',
    () => {
      throw new TypeError('fetch failed')
    },
    { body: [tiingoRow('2025-01-07', 5)] },
  ],
  ['binance', () => ({ status: 500, body: {} }), { body: [kline('2025-01-08', 101)] }],
] as const)('a 40-minute %s outage is not charged to the symbols: all are served right after it', async (source, fail, ok) => {
  const tickers = ['A', 'B', 'C', 'D', 'E', 'F'].map((t) => (source === 'binance' ? `${t}USDT` : t))
  const lastRefresh = source === 'binance' ? '2025-01-08T11:00:00Z' : '2025-01-03T22:31:00Z'
  const ids = tickers.map((ticker, i) => addSymbol(source, ticker, i < 3 ? undefined : lastRefresh))
  for (const id of ids.slice(3)) addCandle(id, '2025-01-03', 11)
  let down = true
  const { market, calls } = setup(() => (down ? fail() : ok))

  for (let minute = 0; minute < 40; minute++) {
    await market.tick()
    now += MINUTE
  }
  expect(calls).toHaveLength(40) // one probe a minute
  expect(ids.map((id) => symbol(id).status)).toEqual(['pending', 'pending', 'pending', 'ready', 'ready', 'ready'])

  down = false
  await market.tick()
  for (const id of ids) {
    expect(symbol(id)).toEqual({ status: 'ready', error: null, last_refreshed_at: new Date(now).toISOString() })
  }
})

test.each([400, 500])(
  'a pending stock that alone keeps answering HTTP %i becomes an error after 5 failures the provider was up for',
  async (status) => {
    const bad = addSymbol('tiingo', 'BAD')
    const { market, calls } = setup((url) =>
      url.pathname.includes('/BAD/') ? { status, body: {} } : { body: [tiingoRow('2025-01-07', 5)] },
    )
    const badCalls = () => calls.filter((c) => c.url.includes('/BAD/')).length
    const start = now
    /** Ticks at `minute`; a ticker added just before must be downloaded in that same tick. */
    const tickAt = async (minute: number, add?: string) => {
      now = start + minute * MINUTE
      const added = add && addSymbol('tiingo', add)
      await market.tick()
      if (added) expect(symbol(added).status).toBe('ready')
    }

    // Nothing else succeeds: it could be an outage, so the failures are not counted.
    for (let minute = 0; minute < 10; minute++) await tickAt(minute)
    expect(badCalls()).toBe(10)
    expect(symbol(bad).status).toBe('pending')

    await tickAt(10, 'AAPL') // 2nd counted failure: next try in 2 minutes
    await tickAt(11, 'MSFT')
    expect(badCalls()).toBe(11)
    await tickAt(12) // 3rd: 4 minutes
    await tickAt(13, 'KO')
    await tickAt(15)
    expect(badCalls()).toBe(12)
    await tickAt(16) // 4th: 8 minutes
    await tickAt(17, 'IBM')
    await tickAt(23)
    expect(badCalls()).toBe(13)
    expect(symbol(bad).status).toBe('pending')

    await tickAt(24) // 5th
    expect(badCalls()).toBe(14)
    expect(symbol(bad)).toEqual({ status: 'error', error: `Tiingo answered HTTP ${status}`, last_refreshed_at: null })

    // Retry from the UI is attempted as soon as the provider pause is over, not after the old back-off.
    const res = await buildApp(db, { market }).inject({ method: 'POST', url: `/api/symbols/${bad}/retry` })
    expect(res.statusCode).toBe(204)
    await tickAt(25)
    expect(badCalls()).toBe(15)
  },
)

test('rate-limit answers are never counted against a pending symbol', async () => {
  const id = addSymbol('binance', 'BTCUSDT')
  const other = addSymbol('binance', 'ETHUSDT', '2025-01-08T11:59:00Z')
  addCandle(other, '2025-01-08', 100)
  let limited = true
  const { market, calls } = setup(() => (limited ? { status: 429, body: {} } : { body: [kline('2025-01-08', 101)] }))

  for (let i = 0; i < 8; i++) {
    await market.tick()
    now += 15 * MINUTE
  }
  expect(calls).toHaveLength(8)
  expect(symbol(id)).toEqual({ status: 'pending', error: null, last_refreshed_at: null })

  limited = false
  await market.tick()
  expect(symbol(id).status).toBe('ready')
  expect(closes(other)).toEqual([{ date: '2025-01-08', close: 101 }])
})

test('a ready stock that keeps failing is retried with a doubling back-off capped at one hour', async () => {
  const id = addSymbol('tiingo', 'GONE', '2025-01-03T22:31:00Z')
  addCandle(id, '2025-01-03', 11)
  const { market, calls } = setup(() => ({ status: 404, body: {} }))

  await market.tick()
  await market.tick()
  expect(calls).toHaveLength(1)

  let expected = 1
  for (const minutes of [1, 2, 4, 8, 16, 32, 60, 60]) {
    now += minutes * MINUTE - 1
    await market.tick()
    expect(calls).toHaveLength(expected)
    now += 1
    await market.tick()
    expect(calls).toHaveLength(++expected)
  }
  expect(symbol(id).status).toBe('ready')
})

test('a rejected token turns every pending stock into an error at once and pauses Tiingo for 15 minutes', async () => {
  const pending = ['AAPL', 'MSFT', 'KO'].map((ticker) => addSymbol('tiingo', ticker))
  const ready = addSymbol('tiingo', 'IBM', '2025-01-03T22:31:00Z')
  addCandle(ready, '2025-01-03', 11)
  const coin = addSymbol('binance', 'BTCUSDT')
  const { market, calls } = setup((url) =>
    url.hostname === 'api.tiingo.com' ? { status: 401, body: {} } : { body: [kline('2025-01-08', 101)] },
  )
  const tiingoCalls = () => calls.filter((c) => c.url.includes('api.tiingo.com')).length

  await market.tick()
  expect(tiingoCalls()).toBe(1)
  for (const id of pending) expect(symbol(id)).toMatchObject({ status: 'error', error: 'Tiingo rejected the token' })
  expect(symbol(ready).status).toBe('ready')
  expect(symbol(coin).status).toBe('ready')

  now += 15 * MINUTE - 1
  await market.tick()
  expect(tiingoCalls()).toBe(1)
  now += 1
  await market.tick()
  expect(tiingoCalls()).toBe(2) // the due refresh of the ready stock
})

test('startup with a token sets stocks that failed for a missing or rejected token back to pending', () => {
  const error = (source: 'tiingo' | 'binance', ticker: string, reason: string) => {
    const id = addSymbol(source, ticker)
    db.prepare("UPDATE symbols SET status = 'error', error = ? WHERE id = ?").run(reason, id)
    return id
  }
  const missing = error('tiingo', 'AAPL', 'Tiingo token not configured')
  const rejected = error('tiingo', 'MSFT', 'Tiingo rejected the token')
  const unknown = error('tiingo', 'NOPE', 'Unknown ticker')
  const coin = error('binance', 'NOPEUSDT', 'Unknown ticker')

  setup(() => ({ body: [] }), null)
  expect(symbol(missing)).toMatchObject({ status: 'error', error: 'Tiingo token not configured' })
  expect(symbol(rejected)).toMatchObject({ status: 'error', error: 'Tiingo rejected the token' })

  setup(() => ({ body: [] }))
  expect(symbol(missing)).toMatchObject({ status: 'pending', error: null })
  expect(symbol(rejected)).toMatchObject({ status: 'pending', error: null })
  expect(symbol(unknown)).toMatchObject({ status: 'error', error: 'Unknown ticker' })
  expect(symbol(coin)).toMatchObject({ status: 'error', error: 'Unknown ticker' })
})

test('a Binance failure pauses every Binance call for a minute, refresh on read included', async () => {
  const pending = addSymbol('binance', 'BTCUSDT')
  const ready = addSymbol('binance', 'ETHUSDT', '2025-01-08T11:00:00Z')
  addCandle(ready, '2025-01-08', 100)
  let down = true
  const { market, calls } = setup(() => (down ? { status: 500, body: {} } : { body: [kline('2025-01-08', 101)] }))

  await market.tick()
  expect(calls).toHaveLength(1) // the 15-minute refresh of ETHUSDT is held back too

  const res = await buildApp(db, { market }).inject({ url: `/api/symbols/${ready}/candles` })
  expect(res.json()).toMatchObject({ candles: [{ close: 100 }] })
  expect(calls).toHaveLength(1)

  down = false
  now += MINUTE - 1
  await market.tick()
  expect(calls).toHaveLength(1)

  now += 1
  await market.tick()
  expect(symbol(pending).status).toBe('ready')
  expect(closes(ready)).toEqual([{ date: '2025-01-08', close: 101 }])
})

test.each([
  [429, undefined, 15],
  [418, undefined, 15],
  [429, '60', 15],
  [418, '1800', 30],
])('Binance HTTP %i with Retry-After %s pauses Binance for %i minutes', async (status, retryAfter, minutes) => {
  const id = addSymbol('binance', 'BTCUSDT')
  let limited = true
  const { market, calls } = setup(() =>
    limited
      ? { status, headers: retryAfter ? { 'Retry-After': retryAfter } : undefined, body: {} }
      : { body: [kline('2025-01-08', 101)] },
  )

  await market.tick()
  expect(calls).toHaveLength(1)

  limited = false
  now += minutes * MINUTE - 1
  await market.tick()
  expect(calls).toHaveLength(1)
  expect(symbol(id).status).toBe('pending')

  now += 1
  await market.tick()
  expect(symbol(id).status).toBe('ready')
})

// --- stocks refresh ---

test('stocksDueDay is the latest weekday whose following 02:00 UTC has passed', () => {
  expect(stocksDueDay(at('2025-01-07T01:59:59Z'))).toBe('2025-01-03') // Monday's cut-off not reached: Friday
  expect(stocksDueDay(at('2025-01-07T02:00:00Z'))).toBe('2025-01-06')
  expect(stocksDueDay(at('2025-01-07T23:00:00Z'))).toBe('2025-01-06')
  expect(stocksDueDay(at('2025-01-11T01:59:59Z'))).toBe('2025-01-09') // Saturday before Friday's cut-off
  expect(stocksDueDay(at('2025-01-11T02:00:00Z'))).toBe('2025-01-10')
  expect(stocksDueDay(at('2025-01-12T23:00:00Z'))).toBe('2025-01-10') // Sunday
  expect(stocksDueDay(at('2025-01-13T23:00:00Z'))).toBe('2025-01-10') // Monday
})

test('stocks refresh runs after 02:00 UTC following each weekday, from the last stored date', async () => {
  const id = addSymbol('tiingo', 'AAPL', '2025-01-04T02:01:00Z')
  addCandle(id, '2025-01-02', 10)
  addCandle(id, '2025-01-03', 11)
  // Tuesday 2025-01-07 has no session: Tiingo keeps answering with data up to Monday.
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-03', 11.5), tiingoRow('2025-01-06', 12)] }))

  for (const time of ['2025-01-04T23:00:00Z', '2025-01-05T23:00:00Z', '2025-01-06T23:00:00Z', '2025-01-07T01:59:00Z']) {
    now = at(time)
    await market.tick()
  }
  expect(calls).toHaveLength(0)

  now = at('2025-01-07T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(1)
  expect(startDate(calls[0])).toBe('2025-01-03')
  // The overlapping last day is replaced, not duplicated.
  expect(closes(id)).toEqual([
    { date: '2025-01-02', close: 10 },
    { date: '2025-01-03', close: 11.5 },
    { date: '2025-01-06', close: 12 },
  ])
  expect(symbol(id).last_refreshed_at).toBe('2025-01-07T02:00:00.000Z')

  for (const time of ['2025-01-07T02:05:00Z', '2025-01-07T22:35:00Z', '2025-01-08T01:59:00Z']) {
    now = at(time)
    await market.tick()
  }
  expect(calls).toHaveLength(1)

  now = at('2025-01-08T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(2)
  expect(startDate(calls[1])).toBe('2025-01-06')

  now = at('2025-01-08T03:00:00Z') // nothing new came back; not asked again right away
  await market.tick()
  expect(calls).toHaveLength(2)
})

test('a stock whose due day is not published yet is asked again once its last refresh is over 6 hours old', async () => {
  const id = addSymbol('tiingo', 'AAPL', '2025-01-04T02:01:00Z')
  addCandle(id, '2025-01-03', 11)
  let published = false
  const { market, calls } = setup(() => ({
    body: published ? [tiingoRow('2025-01-03', 11), tiingoRow('2025-01-06', 12)] : [tiingoRow('2025-01-03', 11)],
  }))

  now = at('2025-01-07T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(1)
  expect(closes(id).at(-1)!.date).toBe('2025-01-03')

  published = true
  now += 6 * HOUR
  await market.tick()
  expect(calls).toHaveLength(1)

  now += 1
  await market.tick()
  expect(calls).toHaveLength(2)
  expect(closes(id).at(-1)).toEqual({ date: '2025-01-06', close: 12 })

  now += 7 * HOUR
  await market.tick()
  expect(calls).toHaveLength(2)
})

test("a candle stored before its day's cut-off is fetched again once at the cut-off and replaced", async () => {
  const id = addSymbol('tiingo', 'AAPL', '2025-01-07T20:00:00Z') // first download during Tuesday's session
  addCandle(id, '2025-01-06', 10)
  addCandle(id, '2025-01-07', 11)
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-07', 11.5)] }))

  now = at('2025-01-08T01:59:59Z')
  await market.tick()
  expect(calls).toHaveLength(0)

  now = at('2025-01-08T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(1)
  expect(startDate(calls[0])).toBe('2025-01-07')
  expect(closes(id)).toEqual([
    { date: '2025-01-06', close: 10 },
    { date: '2025-01-07', close: 11.5 },
  ])

  for (const time of ['2025-01-08T02:05:00Z', '2025-01-08T08:01:00Z', '2025-01-08T23:00:00Z', '2025-01-09T01:59:59Z']) {
    now = at(time)
    await market.tick()
  }
  expect(calls).toHaveLength(1)

  now = at('2025-01-09T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(2)
})

test("a stock refreshed after Friday's cut-off is not requested again before Tuesday 02:00 UTC", async () => {
  const id = addSymbol('tiingo', 'AAPL', '2025-01-11T02:00:00Z')
  addCandle(id, '2025-01-10', 11)
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-13', 12)] }))

  for (const time of ['2025-01-11T12:00:00Z', '2025-01-12T12:00:00Z', '2025-01-13T23:00:00Z', '2025-01-14T01:59:59Z']) {
    now = at(time)
    await market.tick()
  }
  expect(calls).toHaveLength(0)

  now = at('2025-01-14T02:00:00Z')
  await market.tick()
  expect(calls).toHaveLength(1)
})

test('after a Friday holiday a stock is retried only during the 24 hours after the cut-off', async () => {
  const id = addSymbol('tiingo', 'AAPL', '2025-01-10T02:00:00Z')
  addCandle(id, '2025-01-09', 11)
  let monday = false
  const { market, calls } = setup(() => ({
    body: monday ? [tiingoRow('2025-01-09', 11), tiingoRow('2025-01-13', 12)] : [tiingoRow('2025-01-09', 11)],
  }))
  const tickUntil = async (end: string) => {
    for (; now < at(end); now += 15 * MINUTE) await market.tick()
  }

  now = at('2025-01-11T02:00:00Z')
  await tickUntil('2025-01-12T02:00:00Z')
  expect(calls).toHaveLength(4) // the cut-off request and 3 retries
  await tickUntil('2025-01-14T02:00:00Z')
  expect(calls).toHaveLength(4)

  monday = true
  await tickUntil('2025-01-15T02:00:00Z')
  expect(calls).toHaveLength(5)
  expect(closes(id).at(-1)).toEqual({ date: '2025-01-13', close: 12 })
})

test('stocks refresh catches up at startup for symbols that missed it', async () => {
  const missed = addSymbol('tiingo', 'AAPL', '2025-01-03T22:31:00Z')
  addCandle(missed, '2025-01-03', 11)
  const current = addSymbol('tiingo', 'MSFT', '2025-01-08T02:01:00Z')
  addCandle(current, '2025-01-07', 20)
  const { market, calls } = setup(() => ({ body: [tiingoRow('2025-01-07', 12)] }))

  await market.tick() // Wednesday noon: Tuesday's refresh is the one that is due

  expect(calls.map((c) => c.url)).toEqual([
    'https://api.tiingo.com/tiingo/daily/AAPL/prices?startDate=2025-01-03&format=json',
  ])
  expect(closes(missed).at(-1)).toEqual({ date: '2025-01-07', close: 12 })
})

test('a failed refresh keeps a ready symbol ready with its data, and the log never holds the token', async () => {
  const stock = addSymbol('tiingo', 'AAPL', '2025-01-03T22:31:00Z')
  addCandle(stock, '2025-01-03', 11)
  const coin = addSymbol('binance', 'BTCUSDT', '2025-01-08T11:00:00Z')
  addCandle(coin, '2025-01-08', 100)
  const { market, calls } = setup((url) => ({ status: url.hostname === 'api.tiingo.com' ? 404 : 500, body: {} }))

  await market.tick()

  expect(calls).toHaveLength(2)
  expect(symbol(stock)).toEqual({ status: 'ready', error: null, last_refreshed_at: '2025-01-03T22:31:00.000Z' })
  expect(symbol(coin)).toEqual({ status: 'ready', error: null, last_refreshed_at: '2025-01-08T11:00:00.000Z' })
  expect(closes(stock)).toEqual([{ date: '2025-01-03', close: 11 }])
  expect(closes(coin)).toEqual([{ date: '2025-01-08', close: 100 }])
  expect(logs).toEqual([
    'Download failed for tiingo:AAPL: Unknown ticker',
    'Download failed for binance:BTCUSDT: Binance answered HTTP 500',
  ])
  expect(JSON.stringify([logs, calls.map((c) => c.url)])).not.toContain(TOKEN)
})

// --- crypto refresh ---

test('crypto refresh runs every 15 minutes and upserts the running day', async () => {
  const id = addSymbol('binance', 'BTCUSDT', '2025-01-08T11:59:00Z')
  addCandle(id, '2025-01-07', 100)
  addCandle(id, '2025-01-08', 101)
  let close = 102
  const { market, calls } = setup(() => ({ body: [kline('2025-01-08', close)] }))

  await market.tick() // startup
  expect(calls).toHaveLength(1)
  expect(new URL(calls[0].url).searchParams.get('startTime')).toBe(String(at('2025-01-08')))
  expect(closes(id)).toEqual([
    { date: '2025-01-07', close: 100 },
    { date: '2025-01-08', close: 102 },
  ])

  close = 103
  now += 15 * MINUTE - 1
  await market.tick()
  expect(calls).toHaveLength(1)

  now += 1
  await market.tick()
  expect(calls).toHaveLength(2)
  expect(closes(id).at(-1)).toEqual({ date: '2025-01-08', close: 103 })
  expect(symbol(id).last_refreshed_at).toBe(new Date(now).toISOString())
})

// --- refresh on read ---

test('GET candles refreshes a Binance symbol only when its last refresh is older than 60 s', async () => {
  const id = addSymbol('binance', 'BTCUSDT', '2025-01-08T12:00:00Z')
  addCandle(id, '2025-01-08', 100)
  const stock = addSymbol('tiingo', 'AAPL', '2025-01-07T22:31:00Z')
  addCandle(stock, '2025-01-07', 20)
  const { market, calls } = setup(() => ({ body: [kline('2025-01-08', 105), kline(new Date(now).toISOString().slice(0, 10), 106)] }))
  const app = buildApp(db, { market })
  const get = async (symbolId: number) => (await app.inject({ url: `/api/symbols/${symbolId}/candles?tf=D` })).json()

  now += 60_000
  expect((await get(id)).candles).toEqual([{ time: '2025-01-08', open: 100, high: 100, low: 100, close: 100, volume: 1 }])
  expect(calls).toHaveLength(0)

  now += 1
  const fresh = await get(id)
  expect(calls).toHaveLength(1)
  expect(fresh.candles.at(-1)).toMatchObject({ time: '2025-01-08', close: 106 })
  expect(fresh.symbol.lastRefreshedAt).toBe(new Date(now).toISOString())

  await get(id)
  expect(calls).toHaveLength(1)

  now += DAY
  await get(stock)
  expect(calls).toHaveLength(1) // stocks are never refreshed on read
  await Promise.all([get(id), get(id), get(id)])
  expect(calls).toHaveLength(2) // concurrent reads share one refresh
})

test('GET candles still answers with stored data when the refresh fails', async () => {
  const id = addSymbol('binance', 'BTCUSDT', '2025-01-08T11:00:00Z')
  addCandle(id, '2025-01-08', 100)
  const { market } = setup(() => ({ status: 500, body: {} }))
  const res = await buildApp(db, { market }).inject({ url: `/api/symbols/${id}/candles` })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ symbol: { status: 'ready', lastRefreshedAt: '2025-01-08T11:00:00.000Z' }, candles: [{ close: 100 }] })
})
