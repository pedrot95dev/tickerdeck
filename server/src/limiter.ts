import type { Db } from './db.js'

const HOUR = 3_600_000

/** Sliding-window Tiingo request budget, kept in the database so a restart does not reset it. `now` returns epoch milliseconds. */
export function createLimiter(db: Db, now: () => number, perHour: number, perDay: number) {
  const prune = db.prepare('DELETE FROM tiingo_requests WHERE at <= ?')
  const since = db.prepare('SELECT COUNT(*) FROM tiingo_requests WHERE at > ?').pluck()
  const record = db.prepare('INSERT INTO tiingo_requests(at) VALUES (?)')
  const releaseLast = db.prepare('DELETE FROM tiingo_requests WHERE rowid = (SELECT MAX(rowid) FROM tiingo_requests)')
  let pausedUntil = 0
  return {
    /** Takes one request from the budget; false when none is left or the limiter is paused. */
    tryAcquire(): boolean {
      const t = now()
      prune.run(t - 24 * HOUR)
      if (t < pausedUntil || (since.get(t - 24 * HOUR) as number) >= perDay || (since.get(t - HOUR) as number) >= perHour) {
        return false
      }
      record.run(t)
      return true
    },
    /** Gives back the request taken last, for one that never reached Tiingo. */
    release() {
      releaseLast.run()
    },
    pause(ms: number) {
      pausedUntil = now() + ms
    },
  }
}
