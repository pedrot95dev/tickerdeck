import { expect, test } from 'vitest'
import { adjust, aggregate, changePct, type Candle, type CandleRow } from '../src/candles.js'

const row = (date: string, close: number, volume: number, split_factor = 1): CandleRow => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume,
  split_factor,
})

const candle = (time: string, open: number, high: number, low: number, close: number, volume: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
})

test('adjust leaves rows without splits untouched', () => {
  expect(adjust([row('2025-01-02', 10, 5), row('2025-01-03', 11, 6)])).toEqual([
    candle('2025-01-02', 10, 10, 10, 10, 5),
    candle('2025-01-03', 11, 11, 11, 11, 6),
  ])
})

test('adjust divides prices and multiplies volume by the product of all later splits', () => {
  const adjusted = adjust([
    row('2025-01-02', 600, 10),
    row('2025-01-03', 300, 20, 2), // 2:1 split takes effect on this row
    row('2025-01-06', 330, 30),
    row('2025-01-07', 110, 90, 3), // later 3:1 split
    row('2025-01-08', 120, 100),
  ])
  expect(adjusted.map((c) => c.close)).toEqual([100, 100, 110, 110, 120])
  expect(adjusted.map((c) => c.volume)).toEqual([60, 60, 90, 90, 100])
  expect(adjusted[0]).toEqual(candle('2025-01-02', 100, 100, 100, 100, 60))
})

test('adjust handles no rows', () => {
  expect(adjust([])).toEqual([])
})

const days: Candle[] = [
  candle('2024-12-27', 10, 12, 9, 11, 100), // Friday
  candle('2024-12-30', 11, 15, 10, 14, 100), // Monday, ISO week 2025-W01
  candle('2024-12-31', 14, 16, 13, 15, 200),
  candle('2025-01-02', 15, 20, 8, 18, 300), // same ISO week, next year
  candle('2025-01-05', 18, 19, 17, 17, 50), // Sunday closes the week
  candle('2025-01-07', 17, 22, 16, 21, 400), // Tuesday: week whose Monday has no candle
]

test('daily aggregation returns the candles unchanged', () => {
  expect(aggregate(days, 'D')).toEqual(days)
})

test('weekly aggregation buckets by ISO week across a year boundary', () => {
  expect(aggregate(days, 'W')).toEqual([
    candle('2024-12-27', 10, 12, 9, 11, 100),
    candle('2024-12-30', 11, 20, 8, 17, 650),
    candle('2025-01-07', 17, 22, 16, 21, 400),
  ])
})

test('monthly aggregation buckets by calendar month', () => {
  expect(aggregate(days, 'M')).toEqual([
    candle('2024-12-27', 10, 16, 9, 15, 400),
    candle('2025-01-02', 15, 22, 8, 21, 750),
  ])
})

test('aggregation does not mutate its input', () => {
  const copy = structuredClone(days)
  aggregate(days, 'W')
  expect(days).toEqual(copy)
})

test('changePct compares the last two closes', () => {
  expect(changePct([candle('a', 0, 0, 0, 50, 0), candle('b', 0, 0, 0, 100, 0), candle('c', 0, 0, 0, 110, 0)])).toBeCloseTo(10)
  expect(changePct([candle('a', 0, 0, 0, 100, 0), candle('b', 0, 0, 0, 75, 0)])).toBeCloseTo(-25)
})

test('changePct is null with fewer than two candles', () => {
  expect(changePct([])).toBeNull()
  expect(changePct([candle('a', 0, 0, 0, 100, 0)])).toBeNull()
})
