import type { IndicatorSettings, MovingAverage, Watchlist } from './api'

const MA_COLORS = ['#f0b90b', '#42a5f5', '#ab47bc', '#26c6da', '#ff7043', '#9ccc65']
export const maColor = (index: number) => MA_COLORS[index % MA_COLORS.length]

export function parsePeriod(text: string): number | null {
  const n = Number(text)
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : null
}

export function parsePositive(text: string): number | null {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function addMovingAverage(s: IndicatorSettings): IndicatorSettings {
  return { ...s, movingAverages: [...s.movingAverages, { type: 'SMA', period: 20, enabled: true }] }
}

export function removeMovingAverage(s: IndicatorSettings, index: number): IndicatorSettings {
  return { ...s, movingAverages: s.movingAverages.filter((_, i) => i !== index) }
}

export function updateMovingAverage(
  s: IndicatorSettings,
  index: number,
  patch: Partial<MovingAverage>,
): IndicatorSettings {
  return { ...s, movingAverages: s.movingAverages.map((ma, i) => (i === index ? { ...ma, ...patch } : ma)) }
}

export function pollInterval(watchlists: Watchlist[]): number {
  const pending = watchlists.some((w) => w.items.some((i) => i.symbol.status === 'pending'))
  return pending ? 5_000 : 60_000
}
