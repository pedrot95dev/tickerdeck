/** Decimals needed to show a price: 2 from 1 upwards, more for sub-unit crypto prices. */
export function pricePrecision(price: number): number {
  if (!(price > 0) || price >= 1) return 2
  return Math.min(8, Math.ceil(-Math.log10(price)) + 3)
}

export function formatPrice(price: number, precision = pricePrecision(price)): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })
}

export function formatPct(pct: number): string {
  const value = Number(pct.toFixed(2))
  if (value === 0) return '0.00%'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** Label of a measured range, e.g. `+1,234.50 (+12.34%)`. */
export function formatRange(from: number, to: number, precision: number): string {
  const diff = Number((to - from).toFixed(precision)) || 0 // `|| 0` turns -0 into 0
  return `${diff > 0 ? '+' : ''}${formatPrice(diff, precision)} (${formatPct(((to - from) / from) * 100)})`
}

/** Time of the candle whose bucket contains the daily `date`: the last one starting on or before it. */
export function candleTime(candles: { time: string }[], date: string): string {
  return (candles.findLast((c) => c.time <= date) ?? candles[0]).time
}

const DAY = 86_400_000
const STALE_AFTER_DAYS = 5

/** `date` is 'YYYY-MM-DD'. */
function formatDate(date: string, withYear: boolean): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  })
}

/** `lastDate` is the date of the last daily candle. */
export function formatDataTo(lastDate: string | null): string {
  return lastDate ? `data to ${formatDate(lastDate, true)}` : 'not updated yet'
}

/** The last candle's date when it is more than 5 calendar days before today (UTC), otherwise null. */
export function staleDate(lastDate: string | null, now: number): string | null {
  if (!lastDate) return null
  const today = Math.floor(now / DAY) * DAY
  if (today - Date.parse(lastDate) <= STALE_AFTER_DAYS * DAY) return null
  return formatDate(lastDate, lastDate.slice(0, 4) !== new Date(now).toISOString().slice(0, 4))
}
