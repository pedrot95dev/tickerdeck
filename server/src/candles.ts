export type CandleRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  split_factor: number
}

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Timeframe = 'D' | 'W' | 'M'

/** Rows must be ascending by date. A row is adjusted by the splits of all LATER rows. */
export function adjust(rows: CandleRow[]): Candle[] {
  const out = new Array<Candle>(rows.length)
  let factor = 1
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    out[i] = {
      time: r.date,
      open: r.open / factor,
      high: r.high / factor,
      low: r.low / factor,
      close: r.close / factor,
      volume: r.volume * factor,
    }
    factor *= r.split_factor
  }
  return out
}

function bucketKey(date: string, tf: 'W' | 'M'): string {
  if (tf === 'M') return date.slice(0, 7)
  const monday = new Date(`${date}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

/** Candles must be ascending by time. */
export function aggregate(candles: Candle[], tf: Timeframe): Candle[] {
  if (tf === 'D') return candles
  const out: Candle[] = []
  let currentKey = ''
  for (const c of candles) {
    const key = bucketKey(c.time, tf)
    if (key !== currentKey) {
      currentKey = key
      out.push({ ...c })
      continue
    }
    const bucket = out[out.length - 1]
    bucket.high = Math.max(bucket.high, c.high)
    bucket.low = Math.min(bucket.low, c.low)
    bucket.close = c.close
    bucket.volume += c.volume
  }
  return out
}

/** Percent change between the last two (adjusted) closes; null with fewer than two candles. */
export function changePct(candles: Candle[]): number | null {
  if (candles.length < 2) return null
  const prev = candles[candles.length - 2].close
  return ((candles[candles.length - 1].close - prev) / prev) * 100
}
