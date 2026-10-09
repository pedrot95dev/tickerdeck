import { expect, test } from 'vitest'
import {
  candleTime,
  formatDataTo,
  formatPct,
  formatPrice,
  formatRange,
  onlyTailChanged,
  pricePrecision,
  staleDate,
} from './format'

test('pricePrecision uses 2 decimals from 1 upwards and more below', () => {
  expect(pricePrecision(64123.5)).toBe(2)
  expect(pricePrecision(1)).toBe(2)
  expect(pricePrecision(0.5)).toBe(4)
  expect(pricePrecision(0.00012)).toBe(7)
  expect(pricePrecision(1e-12)).toBe(8)
  expect(pricePrecision(0)).toBe(2)
})

test('formatPrice groups thousands and pads decimals', () => {
  expect(formatPrice(64123.5)).toBe('64,123.50')
  expect(formatPrice(0.00012345)).toBe('0.0001235')
  expect(formatPrice(0.5, 2)).toBe('0.50')
})

test('formatPct signs the value and never shows a negative zero', () => {
  expect(formatPct(1.234)).toBe('+1.23%')
  expect(formatPct(-0.5)).toBe('-0.50%')
  expect(formatPct(0)).toBe('0.00%')
  expect(formatPct(-0.001)).toBe('0.00%')
})

test('formatRange signs the price difference and the percentage', () => {
  expect(formatRange(1234.5, 1500, 2)).toBe('+265.50 (+21.51%)')
  expect(formatRange(200, 150, 2)).toBe('-50.00 (-25.00%)')
  expect(formatRange(0.0005, 0.00075, 6)).toBe('+0.000250 (+50.00%)')
  expect(formatRange(100, 100, 2)).toBe('0.00 (0.00%)')
  expect(formatRange(100, 99.999, 2)).toBe('0.00 (0.00%)')
})

test('candleTime maps a daily date to the candle whose bucket contains it', () => {
  const weekly = [{ time: '2025-01-06' }, { time: '2025-01-13' }, { time: '2025-01-20' }]
  expect(candleTime(weekly, '2025-01-13')).toBe('2025-01-13')
  expect(candleTime(weekly, '2025-01-17')).toBe('2025-01-13')
  expect(candleTime(weekly, '2025-01-19')).toBe('2025-01-13')
  expect(candleTime(weekly, '2025-01-02')).toBe('2025-01-06') // before the first candle
  expect(candleTime(weekly, '2026-05-01')).toBe('2025-01-20') // after the last candle
})

test('onlyTailChanged accepts a changed last candle and one appended candle, nothing else', () => {
  const candle = (time: string, close: number) => ({ time, open: 1, high: 2, low: 0.5, close, volume: 10 })
  const prev = [candle('2025-01-06', 10), candle('2025-01-07', 11), candle('2025-01-08', 12)]
  const withLast = (...last: ReturnType<typeof candle>[]) => [...prev.slice(0, 2), ...last]

  expect(onlyTailChanged(prev, withLast(candle('2025-01-08', 12)))).toBe(true)
  expect(onlyTailChanged(prev, withLast(candle('2025-01-08', 13)))).toBe(true)
  expect(onlyTailChanged(prev, withLast(candle('2025-01-08', 13), candle('2025-01-09', 14)))).toBe(true)

  expect(onlyTailChanged(prev, withLast(candle('2025-01-08', 13), candle('2025-01-09', 14), candle('2025-01-10', 15)))).toBe(false)
  expect(onlyTailChanged(prev, prev.slice(0, 2))).toBe(false)
  expect(onlyTailChanged(prev, withLast(candle('2025-01-09', 12)))).toBe(false)
  expect(onlyTailChanged(prev, [candle('2025-01-06', 10), candle('2025-01-07', 11.5), candle('2025-01-08', 12)])).toBe(false)
  expect(onlyTailChanged(prev, [{ ...prev[0], volume: 11 }, prev[1], prev[2]])).toBe(false)
  expect(onlyTailChanged(prev, prev.slice(1))).toBe(false)
  expect(onlyTailChanged([], [candle('2025-01-06', 10)])).toBe(false)
})

test('formatDataTo shows the date of the last candle', () => {
  expect(formatDataTo(null)).toBe('not updated yet')
  expect(formatDataTo('2026-10-08')).toBe('data to 8 Oct 2026')
  expect(formatDataTo('2026-10-08', null)).toBe('data to 8 Oct 2026')
})

test('formatDataTo shows the local time of an intraday quote instead', () => {
  const quotedAt = '2026-10-08T19:05:00+00:00'
  expect(formatDataTo('2026-10-08', quotedAt, 'UTC')).toBe('price at 19:05 8 Oct')
  expect(formatDataTo('2026-10-08', quotedAt, 'Europe/Lisbon')).toBe('price at 20:05 8 Oct')
  expect(formatDataTo('2026-10-08', quotedAt, 'Asia/Tokyo')).toBe('price at 04:05 9 Oct')
  const local = new Date(quotedAt)
  const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
  expect(formatDataTo('2026-10-08', quotedAt)).toContain(`price at ${hhmm} ${local.getDate()} `)
})

test('staleDate dates a last candle more than 5 calendar days old', () => {
  const now = Date.parse('2026-10-12T15:30:00Z') // a Monday
  expect(staleDate('2026-10-12', now)).toBeNull()
  expect(staleDate('2026-10-09', now)).toBeNull() // Friday's close
  expect(staleDate('2026-10-07', now)).toBeNull() // 5 days
  expect(staleDate('2026-10-06', now)).toBe('6 Oct')
  expect(staleDate('2025-12-10', now)).toBe('10 Dec 2025')
  expect(staleDate(null, now)).toBeNull()
})
