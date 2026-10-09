import { expect, test } from 'vitest'
import { openDb } from '../src/db.js'
import { createLimiter } from '../src/limiter.js'

const HOUR = 3_600_000

function take(limiter: { tryAcquire(): boolean }, n: number): number {
  let granted = 0
  for (let i = 0; i < n; i++) if (limiter.tryAcquire()) granted++
  return granted
}

test('refuses the 46th call within an hour and allows it once the window has passed', () => {
  let now = 1_000_000
  const limiter = createLimiter(openDb(':memory:'), () => now, 45, 900)
  expect(take(limiter, 45)).toBe(45)
  expect(limiter.tryAcquire()).toBe(false)
  now += HOUR - 1
  expect(limiter.tryAcquire()).toBe(false)
  now += 1
  expect(limiter.tryAcquire()).toBe(true)
})

test('enforces the daily cap across hours', () => {
  let now = 0
  const limiter = createLimiter(openDb(':memory:'), () => now, 45, 900)
  for (let hour = 0; hour < 20; hour++) {
    expect(take(limiter, 50)).toBe(45)
    now += HOUR
  }
  // 900 calls made in hours 0..19; the day's budget is spent until the first hour ages out.
  expect(limiter.tryAcquire()).toBe(false)
  now = 24 * HOUR - 1
  expect(limiter.tryAcquire()).toBe(false)
  now = 24 * HOUR
  expect(take(limiter, 50)).toBe(45)
})

test('a pause refuses calls until it is over', () => {
  let now = 0
  const limiter = createLimiter(openDb(':memory:'), () => now, 45, 900)
  limiter.pause(1000)
  expect(limiter.tryAcquire()).toBe(false)
  now = 1000
  expect(limiter.tryAcquire()).toBe(true)
})

test('the budget survives a restart and old requests are pruned', () => {
  let now = 1_000_000
  const db = openDb(':memory:')
  expect(take(createLimiter(db, () => now, 45, 900), 45)).toBe(45)

  const restarted = createLimiter(db, () => now, 45, 900)
  expect(restarted.tryAcquire()).toBe(false)
  now += HOUR
  expect(take(restarted, 50)).toBe(45)

  now += 24 * HOUR
  expect(restarted.tryAcquire()).toBe(true)
  expect(db.prepare('SELECT COUNT(*) FROM tiingo_requests').pluck().get()).toBe(1)
})
