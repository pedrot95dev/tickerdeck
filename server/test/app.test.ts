import type { FastifyInstance } from 'fastify'
import { beforeEach, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb, type Db } from '../src/db.js'
import { DEFAULT_INDICATOR_SETTINGS } from '../src/settings.js'

let db: Db
let app: FastifyInstance

beforeEach(() => {
  db = openDb(':memory:')
  app = buildApp(db)
})

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function call(method: Method, url: string, payload?: unknown) {
  const res = await app.inject({ method, url: `/api${url}`, payload: payload as object | undefined })
  return { status: res.statusCode, body: res.body ? res.json() : undefined }
}

async function createList(name = 'Main'): Promise<number> {
  return (await call('POST', '/watchlists', { name })).body.id
}

async function addItems(listId: number, text: string) {
  return (await call('POST', `/watchlists/${listId}/items`, { text })).body
}

async function items(listId: number) {
  const lists = (await call('GET', '/watchlists')).body as { id: number; items: any[] }[]
  return lists.find((l) => l.id === listId)!.items
}

function addCandle(symbolId: number, date: string, close: number, volume = 1, splitFactor = 1) {
  db.prepare(
    'INSERT INTO candles(symbol_id, date, open, high, low, close, volume, split_factor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(symbolId, date, close, close, close, close, volume, splitFactor)
}

const count = (table: string) => db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()

const RANGE = { fromDate: '2025-01-02', fromPrice: 100.5, toDate: '2025-03-14', toPrice: 120 }

// --- health ---

test('health reports ok while the database answers', async () => {
  expect(await call('GET', '/health')).toEqual({ status: 200, body: { status: 'ok' } })
})

test('health fails once the database is gone', async () => {
  db.close()
  expect((await call('GET', '/health')).status).toBe(500)
})

// --- watchlists ---

test('GET /watchlists is empty at first', async () => {
  expect(await call('GET', '/watchlists')).toEqual({ status: 200, body: [] })
})

test('POST /watchlists creates a list and lists come back in creation order', async () => {
  const res = await call('POST', '/watchlists', { name: '  Tech  ' })
  expect(res).toEqual({ status: 201, body: { id: 1, name: 'Tech', items: [] } })
  await createList('Crypto')
  expect((await call('GET', '/watchlists')).body.map((l: any) => l.name)).toEqual(['Tech', 'Crypto'])
})

test('POST /watchlists rejects a missing or blank name', async () => {
  for (const payload of [{}, { name: '' }, { name: '   ' }, { name: 5 }, undefined]) {
    const res = await call('POST', '/watchlists', payload)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: expect.any(String) })
  }
})

test('PATCH /watchlists/:id renames', async () => {
  const id = await createList()
  await addItems(id, 'AAPL')
  const res = await call('PATCH', `/watchlists/${id}`, { name: 'Renamed' })
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ id, name: 'Renamed', items: [{ symbol: { ticker: 'AAPL' } }] })
  expect((await call('GET', '/watchlists')).body[0].name).toBe('Renamed')
})

test('PATCH /watchlists/:id: 400 on blank name, 404 on unknown id', async () => {
  const id = await createList()
  expect((await call('PATCH', `/watchlists/${id}`, { name: ' ' })).status).toBe(400)
  expect(await call('PATCH', '/watchlists/999', { name: 'x' })).toEqual({
    status: 404,
    body: { error: 'Watchlist not found' },
  })
})

test('DELETE /watchlists/:id deletes orphaned symbols but keeps shared ones', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL MSFT')
  await addItems(b, 'MSFT')
  const [aapl] = await items(a)
  addCandle(aapl.symbol.id, '2025-01-02', 10)
  await call('POST', `/symbols/${aapl.symbol.id}/lines`, { price: 5 })
  await call('POST', `/symbols/${aapl.symbol.id}/ranges`, RANGE)
  expect(count('ranges')).toBe(1)

  expect((await call('DELETE', `/watchlists/${a}`)).status).toBe(204)

  expect(db.prepare('SELECT ticker FROM symbols').pluck().all()).toEqual(['MSFT'])
  expect(count('candles')).toBe(0)
  expect(count('lines')).toBe(0)
  expect(count('ranges')).toBe(0)
  expect((await call('GET', '/watchlists')).body.map((l: any) => l.id)).toEqual([b])
})

test('DELETE /watchlists/:id: 404 on unknown id', async () => {
  expect((await call('DELETE', '/watchlists/999')).status).toBe(404)
})

test('PUT /watchlists/order reorders the lists, and a new list still goes last', async () => {
  const a = await createList('A')
  const b = await createList('B')
  const c = await createList('C')
  expect((await call('PUT', '/watchlists/order', { ids: [c, a, b] })).status).toBe(204)
  const d = await createList('D')
  expect((await call('GET', '/watchlists')).body.map((l: any) => l.id)).toEqual([c, a, b, d])
})

test('PUT /watchlists/order: 400 on malformed ids, 409 unless every list is named once', async () => {
  const a = await createList('A')
  const b = await createList('B')
  for (const payload of [undefined, {}, { ids: 'x' }, { ids: [a, '2'] }, { ids: [a, 1.5] }]) {
    expect((await call('PUT', '/watchlists/order', payload)).status, JSON.stringify(payload)).toBe(400)
  }
  for (const ids of [[], [b], [b, b], [b, a, 999], [b, a, a]]) {
    expect((await call('PUT', '/watchlists/order', { ids })).status, JSON.stringify(ids)).toBe(409)
  }
  expect((await call('GET', '/watchlists')).body.map((l: any) => l.id)).toEqual([a, b])
})

// --- items ---

test('PUT items/order reorders one list only, and a new ticker still goes last', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL MSFT NVDA')
  await addItems(b, 'AAPL MSFT')
  const [aapl, msft, nvda] = (await items(a)).map((i) => i.id)

  expect((await call('PUT', `/watchlists/${a}/items/order`, { ids: [nvda, aapl, msft] })).status).toBe(204)
  await addItems(a, 'TSLA')

  expect((await items(a)).map((i) => i.symbol.ticker)).toEqual(['NVDA', 'AAPL', 'MSFT', 'TSLA'])
  expect((await items(b)).map((i) => i.symbol.ticker)).toEqual(['AAPL', 'MSFT'])
})

test('PUT items/order: 404 on unknown list, 400 on malformed ids, 409 unless every item is named once', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL MSFT')
  await addItems(b, 'NVDA')
  const [aapl, msft] = (await items(a)).map((i) => i.id)
  const [other] = (await items(b)).map((i) => i.id)

  expect((await call('PUT', '/watchlists/999/items/order', { ids: [] })).status).toBe(404)
  expect((await call('PUT', `/watchlists/${a}/items/order`, { ids: 'x' })).status).toBe(400)
  for (const ids of [[msft], [msft, msft], [msft, aapl, other], [msft, other]]) {
    expect((await call('PUT', `/watchlists/${a}/items/order`, { ids })).status, JSON.stringify(ids)).toBe(409)
  }
  expect((await items(a)).map((i) => i.id)).toEqual([aapl, msft])
})

test('POST /watchlists/:id/items adds resolved tickers as pending symbols, in order', async () => {
  const id = await createList()
  expect(await addItems(id, 'NASDAQ:AAPL,BINANCE:BTCUSDT,###SECTION NAME,NYSE:BRK.B')).toEqual({ added: 3, skipped: 0 })
  expect(await items(id)).toEqual([
    {
      id: 1,
      symbol: { id: 1, source: 'tiingo', ticker: 'AAPL', status: 'pending', error: null, lastRefreshedAt: null, quotedAt: null },
      lastClose: null,
      changePct: null,
      lastDate: null,
    },
    {
      id: 2,
      symbol: { id: 2, source: 'binance', ticker: 'BTCUSDT', status: 'pending', error: null, lastRefreshedAt: null, quotedAt: null },
      lastClose: null,
      changePct: null,
      lastDate: null,
    },
    {
      id: 3,
      symbol: { id: 3, source: 'tiingo', ticker: 'BRK-B', status: 'pending', error: null, lastRefreshedAt: null, quotedAt: null },
      lastClose: null,
      changePct: null,
      lastDate: null,
    },
  ])
})

test('POST /watchlists/:id/items skips tickers already in the list and repeats in the input', async () => {
  const id = await createList()
  await addItems(id, 'AAPL')
  expect(await addItems(id, 'AAPL, MSFT, msft, BTCUSD, BINANCE:BTCUSDT')).toEqual({ added: 2, skipped: 3 })
  expect((await items(id)).map((i) => i.symbol.ticker)).toEqual(['AAPL', 'MSFT', 'BTCUSDT'])
})

test('POST /watchlists/:id/items shares one symbol between lists', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL')
  expect(await addItems(b, 'AAPL')).toEqual({ added: 1, skipped: 0 })
  expect(count('symbols')).toBe(1)
})

test('POST /watchlists/:id/items: 400 without text, 404 on unknown list', async () => {
  const id = await createList()
  expect((await call('POST', `/watchlists/${id}/items`, {})).status).toBe(400)
  expect((await call('POST', `/watchlists/${id}/items`, { text: 5 })).status).toBe(400)
  expect((await call('POST', '/watchlists/999/items', { text: 'AAPL' })).status).toBe(404)
})

test('DELETE item removes the orphaned symbol with its candles and lines', async () => {
  const id = await createList()
  await addItems(id, 'AAPL MSFT')
  const [aapl] = await items(id)
  addCandle(aapl.symbol.id, '2025-01-02', 10)
  await call('POST', `/symbols/${aapl.symbol.id}/lines`, { price: 5 })
  await call('POST', `/symbols/${aapl.symbol.id}/ranges`, RANGE)
  expect(count('ranges')).toBe(1)

  expect((await call('DELETE', `/watchlists/${id}/items/${aapl.id}`)).status).toBe(204)

  expect((await items(id)).map((i) => i.symbol.ticker)).toEqual(['MSFT'])
  expect(db.prepare('SELECT ticker FROM symbols').pluck().all()).toEqual(['MSFT'])
  expect(count('candles')).toBe(0)
  expect(count('lines')).toBe(0)
  expect(count('ranges')).toBe(0)
})

test('DELETE item keeps a symbol that another list still uses', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL')
  await addItems(b, 'AAPL')
  const [item] = await items(a)
  await call('DELETE', `/watchlists/${a}/items/${item.id}`)
  expect(count('symbols')).toBe(1)
  expect(await items(b)).toHaveLength(1)
})

test('DELETE item: 404 on unknown list, unknown item, or item of another list', async () => {
  const a = await createList('A')
  const b = await createList('B')
  await addItems(a, 'AAPL')
  const [item] = await items(a)
  expect((await call('DELETE', `/watchlists/999/items/${item.id}`)).status).toBe(404)
  expect((await call('DELETE', `/watchlists/${a}/items/999`)).status).toBe(404)
  expect((await call('DELETE', `/watchlists/${b}/items/${item.id}`)).status).toBe(404)
  expect(await items(a)).toHaveLength(1)
})

// --- quotes in the watchlist ---

test('GET /watchlists reports last close, date and changePct on adjusted closes', async () => {
  const id = await createList()
  await addItems(id, 'AAPL MSFT')
  const [aapl, msft] = await items(id)
  addCandle(aapl.symbol.id, '2025-01-02', 90)
  addCandle(aapl.symbol.id, '2025-01-03', 200)
  addCandle(aapl.symbol.id, '2025-01-06', 110, 1, 2) // 2:1 split: previous adjusted close is 100
  addCandle(msft.symbol.id, '2025-01-06', 40)

  const [a, m] = await items(id)
  expect(a).toMatchObject({ lastClose: 110, lastDate: '2025-01-06' })
  expect(a.changePct).toBeCloseTo(10)
  expect(m).toMatchObject({ lastClose: 40, lastDate: '2025-01-06', changePct: null })
})

// --- symbols ---

test('POST /symbols/:id/retry sets an error symbol back to pending', async () => {
  const id = await createList()
  await addItems(id, 'NOPE')
  db.prepare("UPDATE symbols SET status = 'error', error = 'Unknown ticker'").run()

  expect((await call('POST', '/symbols/1/retry')).status).toBe(204)
  expect((await items(id))[0].symbol).toMatchObject({ status: 'pending', error: null })
})

test('POST /symbols/:id/retry leaves a ready symbol alone; 404 on unknown id', async () => {
  const id = await createList()
  await addItems(id, 'AAPL')
  db.prepare("UPDATE symbols SET status = 'ready'").run()
  expect((await call('POST', '/symbols/1/retry')).status).toBe(204)
  expect((await items(id))[0].symbol.status).toBe('ready')
  expect((await call('POST', '/symbols/999/retry')).status).toBe(404)
})

test('GET candles returns stored rows ascending and split-adjusted, per timeframe', async () => {
  const id = await createList()
  await addItems(id, 'AAPL')
  db.prepare("UPDATE symbols SET status = 'ready', last_refreshed_at = '2025-02-04T00:00:00.000Z'").run()
  addCandle(1, '2025-02-03', 55, 40, 2)
  addCandle(1, '2025-01-30', 100, 10)
  addCandle(1, '2025-01-31', 120, 20)
  addCandle(1, '2025-02-04', 60, 50)

  const daily = await call('GET', '/symbols/1/candles?tf=D')
  expect(daily.status).toBe(200)
  expect(daily.body).toEqual({
    symbol: {
      id: 1,
      source: 'tiingo',
      ticker: 'AAPL',
      status: 'ready',
      error: null,
      lastRefreshedAt: '2025-02-04T00:00:00.000Z',
      quotedAt: null,
    },
    candles: [
      { time: '2025-01-30', open: 50, high: 50, low: 50, close: 50, volume: 20 },
      { time: '2025-01-31', open: 60, high: 60, low: 60, close: 60, volume: 40 },
      { time: '2025-02-03', open: 55, high: 55, low: 55, close: 55, volume: 40 },
      { time: '2025-02-04', open: 60, high: 60, low: 60, close: 60, volume: 50 },
    ],
  })
  expect((await call('GET', '/symbols/1/candles')).body).toEqual(daily.body)

  expect((await call('GET', '/symbols/1/candles?tf=W')).body.candles).toEqual([
    { time: '2025-01-30', open: 50, high: 60, low: 50, close: 60, volume: 60 },
    { time: '2025-02-03', open: 55, high: 60, low: 55, close: 60, volume: 90 },
  ])
  expect((await call('GET', '/symbols/1/candles?tf=M')).body.candles).toEqual([
    { time: '2025-01-30', open: 50, high: 60, low: 50, close: 60, volume: 60 },
    { time: '2025-02-03', open: 55, high: 60, low: 55, close: 60, volume: 90 },
  ])
})

test('GET candles is empty for a symbol without data', async () => {
  await addItems(await createList(), 'AAPL')
  expect((await call('GET', '/symbols/1/candles?tf=D')).body.candles).toEqual([])
})

test('GET candles: 400 on a bad tf, 404 on unknown symbol', async () => {
  await addItems(await createList(), 'AAPL')
  for (const tf of ['X', 'd', '', '1D']) {
    expect(await call('GET', `/symbols/1/candles?tf=${tf}`)).toEqual({
      status: 400,
      body: { error: 'tf must be D, W or M' },
    })
  }
  expect((await call('GET', '/symbols/999/candles?tf=D')).status).toBe(404)
})

// --- lines ---

test('lines: create, list, move, delete', async () => {
  await addItems(await createList(), 'AAPL')
  expect(await call('GET', '/symbols/1/lines')).toEqual({ status: 200, body: [] })

  expect(await call('POST', '/symbols/1/lines', { price: 101.5 })).toEqual({
    status: 201,
    body: { id: 1, price: 101.5 },
  })
  await call('POST', '/symbols/1/lines', { price: 90 })
  expect(await call('PATCH', '/lines/1', { price: 105.25 })).toEqual({ status: 200, body: { id: 1, price: 105.25 } })
  expect((await call('GET', '/symbols/1/lines')).body).toEqual([
    { id: 1, price: 105.25 },
    { id: 2, price: 90 },
  ])

  expect((await call('DELETE', '/lines/1')).status).toBe(204)
  expect((await call('GET', '/symbols/1/lines')).body).toEqual([{ id: 2, price: 90 }])
})

test('lines: 400 on a non-finite or non-positive price', async () => {
  await addItems(await createList(), 'AAPL')
  await call('POST', '/symbols/1/lines', { price: 10 })
  for (const payload of [{}, { price: 0 }, { price: -1 }, { price: '10' }, { price: null }]) {
    expect((await call('POST', '/symbols/1/lines', payload)).status).toBe(400)
    expect((await call('PATCH', '/lines/1', payload)).status).toBe(400)
  }
  // JSON cannot carry Infinity/NaN as numbers; an overflowing literal is the closest a client can get.
  const res = await app.inject({
    method: 'POST',
    url: '/api/symbols/1/lines',
    headers: { 'content-type': 'application/json' },
    payload: '{"price":1e999}',
  })
  expect(res.statusCode).toBe(400)
  expect((await call('GET', '/symbols/1/lines')).body).toEqual([{ id: 1, price: 10 }])
})

test('lines: 404 on unknown symbol or line', async () => {
  expect((await call('GET', '/symbols/999/lines')).status).toBe(404)
  expect((await call('POST', '/symbols/999/lines', { price: 1 })).status).toBe(404)
  expect((await call('PATCH', '/lines/999', { price: 1 })).status).toBe(404)
  expect((await call('DELETE', '/lines/999')).status).toBe(404)
})

// --- ranges ---

test('ranges: create, list, delete', async () => {
  await addItems(await createList(), 'AAPL MSFT')
  expect(await call('GET', '/symbols/1/ranges')).toEqual({ status: 200, body: [] })

  const down = { fromDate: '2025-03-14', fromPrice: 120, toDate: '2025-01-02', toPrice: 90.25 }
  expect(await call('POST', '/symbols/1/ranges', RANGE)).toEqual({ status: 201, body: { id: 1, ...RANGE } })
  expect(await call('POST', '/symbols/1/ranges', down)).toEqual({ status: 201, body: { id: 2, ...down } })
  await call('POST', '/symbols/2/ranges', RANGE)
  expect((await call('GET', '/symbols/1/ranges')).body).toEqual([
    { id: 1, ...RANGE },
    { id: 2, ...down },
  ])

  expect((await call('DELETE', '/ranges/1')).status).toBe(204)
  expect((await call('GET', '/symbols/1/ranges')).body).toEqual([{ id: 2, ...down }])
  expect((await call('GET', '/symbols/2/ranges')).body).toEqual([{ id: 3, ...RANGE }])
})

test('ranges: 400 on an invalid date or a non-finite or non-positive price', async () => {
  await addItems(await createList(), 'AAPL')
  const invalid = [
    undefined,
    {},
    { ...RANGE, fromDate: undefined },
    { ...RANGE, fromDate: '2025-1-2' },
    { ...RANGE, fromDate: '2025-02-30' },
    { ...RANGE, toDate: '2025-13-01' },
    { ...RANGE, toDate: '2025-01-02T00:00:00Z' },
    { ...RANGE, toDate: 20250102 },
    { ...RANGE, fromPrice: 0 },
    { ...RANGE, fromPrice: '100' },
    { ...RANGE, toPrice: -1 },
    { ...RANGE, toPrice: null },
  ]
  for (const payload of invalid) {
    expect((await call('POST', '/symbols/1/ranges', payload)).status, JSON.stringify(payload)).toBe(400)
  }
  // JSON cannot carry Infinity/NaN as numbers; an overflowing literal is the closest a client can get.
  const res = await app.inject({
    method: 'POST',
    url: '/api/symbols/1/ranges',
    headers: { 'content-type': 'application/json' },
    payload: '{"fromDate":"2025-01-02","fromPrice":100,"toDate":"2025-03-14","toPrice":1e999}',
  })
  expect(res.statusCode).toBe(400)
  expect((await call('GET', '/symbols/1/ranges')).body).toEqual([])
})

test('ranges: 404 on unknown symbol or range', async () => {
  expect((await call('GET', '/symbols/999/ranges')).status).toBe(404)
  expect((await call('POST', '/symbols/999/ranges', RANGE)).status).toBe(404)
  expect(await call('DELETE', '/ranges/999')).toEqual({ status: 404, body: { error: 'Range not found' } })
})

// --- settings ---

test('GET /settings/indicators returns the defaults until saved', async () => {
  expect(await call('GET', '/settings/indicators')).toEqual({ status: 200, body: DEFAULT_INDICATOR_SETTINGS })
})

test('PUT /settings/indicators saves and returns the settings, dropping unknown fields', async () => {
  const settings = {
    movingAverages: [{ type: 'EMA', period: 9, enabled: false }],
    bollinger: { enabled: true, period: 10, stdDev: 1.5 },
    volume: { enabled: false },
    rsi: { enabled: false, period: 7 },
    macd: { enabled: true, fast: 5, slow: 10, signal: 3 },
  }
  expect(await call('PUT', '/settings/indicators', { ...settings, extra: 1 })).toEqual({ status: 200, body: settings })
  expect((await call('GET', '/settings/indicators')).body).toEqual(settings)

  const empty = { ...settings, movingAverages: [] }
  expect((await call('PUT', '/settings/indicators', empty)).body).toEqual(empty)
  expect((await call('GET', '/settings/indicators')).body).toEqual(empty)
})

test('PUT /settings/indicators: 400 on an invalid shape', async () => {
  const d = DEFAULT_INDICATOR_SETTINGS
  const invalid = [
    undefined,
    [],
    {},
    { ...d, movingAverages: 'x' },
    { ...d, movingAverages: [{ type: 'WMA', period: 20, enabled: true }] },
    { ...d, movingAverages: [{ type: 'SMA', period: 0, enabled: true }] },
    { ...d, movingAverages: [{ type: 'SMA', period: 2.5, enabled: true }] },
    { ...d, movingAverages: [{ type: 'SMA', period: 20 }] },
    { ...d, bollinger: { ...d.bollinger, stdDev: 0 } },
    { ...d, bollinger: { ...d.bollinger, period: '20' } },
    { ...d, volume: {} },
    { ...d, rsi: { enabled: true, period: -1 } },
    { ...d, macd: { ...d.macd, signal: 1.5 } },
    { ...d, macd: undefined },
  ]
  for (const payload of invalid) {
    expect((await call('PUT', '/settings/indicators', payload)).status, JSON.stringify(payload)).toBe(400)
  }
  expect((await call('GET', '/settings/indicators')).body).toEqual(d)
})

// --- errors ---

test('unknown routes and malformed JSON answer with { error }', async () => {
  expect(await call('GET', '/nope')).toEqual({ status: 404, body: { error: 'Not found' } })
  const res = await app.inject({
    method: 'POST',
    url: '/api/watchlists',
    headers: { 'content-type': 'application/json' },
    payload: '{bad',
  })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: expect.any(String) })
})
