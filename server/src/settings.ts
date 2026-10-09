export type IndicatorSettings = {
  movingAverages: { type: 'SMA' | 'EMA'; period: number; enabled: boolean }[]
  bollinger: { enabled: boolean; period: number; stdDev: number }
  volume: { enabled: boolean }
  rsi: { enabled: boolean; period: number }
  macd: { enabled: boolean; fast: number; slow: number; signal: number }
}

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
  movingAverages: [
    { type: 'SMA', period: 20, enabled: true },
    { type: 'SMA', period: 50, enabled: true },
    { type: 'SMA', period: 200, enabled: true },
  ],
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  volume: { enabled: true },
  rsi: { enabled: true, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPeriod = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** Returns the settings stripped to the known fields, or null if the shape is invalid. */
export function parseIndicatorSettings(v: unknown): IndicatorSettings | null {
  if (!isObj(v)) return null
  const { movingAverages: mas, bollinger: bb, volume, rsi, macd } = v
  if (!Array.isArray(mas) || !isObj(bb) || !isObj(volume) || !isObj(rsi) || !isObj(macd)) return null

  const movingAverages: IndicatorSettings['movingAverages'] = []
  for (const ma of mas) {
    if (!isObj(ma) || (ma.type !== 'SMA' && ma.type !== 'EMA')) return null
    if (!isPeriod(ma.period) || !isBool(ma.enabled)) return null
    movingAverages.push({ type: ma.type, period: ma.period, enabled: ma.enabled })
  }
  if (!isBool(bb.enabled) || !isPeriod(bb.period)) return null
  if (typeof bb.stdDev !== 'number' || !Number.isFinite(bb.stdDev) || bb.stdDev <= 0) return null
  if (!isBool(volume.enabled)) return null
  if (!isBool(rsi.enabled) || !isPeriod(rsi.period)) return null
  if (!isBool(macd.enabled) || !isPeriod(macd.fast) || !isPeriod(macd.slow) || !isPeriod(macd.signal)) return null

  return {
    movingAverages,
    bollinger: { enabled: bb.enabled, period: bb.period, stdDev: bb.stdDev },
    volume: { enabled: volume.enabled },
    rsi: { enabled: rsi.enabled, period: rsi.period },
    macd: { enabled: macd.enabled, fast: macd.fast, slow: macd.slow, signal: macd.signal },
  }
}
