import type { IndicatorSettings } from '../api'
import { maColor, updateMovingAverage } from '../settings'

type Props = { settings: IndicatorSettings; onChange: (settings: IndicatorSettings) => void }

export function IndicatorToggles({ settings: s, onChange }: Props) {
  const toggle = (key: 'bollinger' | 'volume' | 'rsi' | 'macd', label: string) => (
    <button
      className={s[key].enabled ? 'active' : ''}
      aria-pressed={s[key].enabled}
      onClick={() => onChange({ ...s, [key]: { ...s[key], enabled: !s[key].enabled } })}
    >
      {label}
    </button>
  )
  return (
    <div className="group">
      {s.movingAverages.map((ma, i) => (
        <button
          key={i}
          className={ma.enabled ? 'active' : ''}
          aria-pressed={ma.enabled}
          style={{ borderBottomColor: maColor(i) }}
          onClick={() => onChange(updateMovingAverage(s, i, { enabled: !ma.enabled }))}
        >
          {ma.type} {ma.period}
        </button>
      ))}
      {toggle('bollinger', 'Bollinger')}
      {toggle('volume', 'Volume')}
      {toggle('rsi', 'RSI')}
      {toggle('macd', 'MACD')}
    </div>
  )
}
