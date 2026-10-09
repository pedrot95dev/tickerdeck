import { expect, test } from 'vitest'
import type { IndicatorSettings, Watchlist } from './api'
import {
  addMovingAverage,
  parsePeriod,
  parsePositive,
  pollInterval,
  removeMovingAverage,
  updateMovingAverage,
} from './settings'

const settings: IndicatorSettings = {
  movingAverages: [
    { type: 'SMA', period: 20, enabled: true },
    { type: 'SMA', period: 50, enabled: true },
  ],
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  volume: { enabled: true },
  rsi: { enabled: true, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
}

test('parsePeriod accepts only integers from 1', () => {
  expect(parsePeriod('14')).toBe(14)
  expect(parsePeriod('1')).toBe(1)
  for (const bad of ['', ' ', '0', '-3', '2.5', 'abc']) expect(parsePeriod(bad)).toBeNull()
})

test('parsePositive accepts only finite numbers above 0', () => {
  expect(parsePositive('2.5')).toBe(2.5)
  for (const bad of ['', '0', '-1', 'abc', 'Infinity']) expect(parsePositive(bad)).toBeNull()
})

test('addMovingAverage appends an enabled SMA 20 without mutating the input', () => {
  const next = addMovingAverage(settings)
  expect(next.movingAverages).toHaveLength(3)
  expect(next.movingAverages[2]).toEqual({ type: 'SMA', period: 20, enabled: true })
  expect(settings.movingAverages).toHaveLength(2)
})

test('removeMovingAverage drops only the given index', () => {
  expect(removeMovingAverage(settings, 0).movingAverages).toEqual([{ type: 'SMA', period: 50, enabled: true }])
})

test('updateMovingAverage patches only the given index', () => {
  const next = updateMovingAverage(settings, 1, { type: 'EMA', period: 9 })
  expect(next.movingAverages).toEqual([
    { type: 'SMA', period: 20, enabled: true },
    { type: 'EMA', period: 9, enabled: true },
  ])
  expect(next.rsi).toBe(settings.rsi)
})

test('pollInterval is 5 s while any symbol is pending, 10 s with a ready crypto symbol, otherwise 60 s', () => {
  const list = (source: 'tiingo' | 'binance', ...statuses: ('pending' | 'ready' | 'error')[]): Watchlist => ({
    id: 1,
    name: 'A',
    items: statuses.map((status, id) => ({
      id,
      symbol: { id, source, ticker: 'X', status, error: null, lastRefreshedAt: null, quotedAt: null },
      lastClose: null,
      changePct: null,
      lastDate: null,
    })),
  })
  expect(pollInterval([])).toBe(60_000)
  expect(pollInterval([list('tiingo', 'ready', 'error')])).toBe(60_000)
  expect(pollInterval([list('binance', 'error')])).toBe(60_000)
  expect(pollInterval([list('tiingo', 'ready'), list('binance', 'error', 'ready')])).toBe(10_000)
  expect(pollInterval([list('binance', 'ready'), list('tiingo', 'error', 'pending')])).toBe(5_000)
})
