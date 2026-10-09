import { useState } from 'react'
import type { IndicatorSettings } from '../api'
import {
  addMovingAverage,
  maColor,
  parsePeriod,
  parsePositive,
  removeMovingAverage,
  updateMovingAverage,
} from '../settings'

type Props = { settings: IndicatorSettings; onChange: (settings: IndicatorSettings) => void }

export function SettingsPanel({ settings: s, onChange }: Props) {
  return (
    <div className="settings-panel">
      <fieldset>
        <legend>Moving averages</legend>
        {s.movingAverages.map((ma, i) => (
          // Keyed by list length too, so removing a row does not leave its typed text on the next one.
          <div className="row" key={`${i}/${s.movingAverages.length}`}>
            <span className="swatch" style={{ background: maColor(i) }} />
            <select
              value={ma.type}
              aria-label="Type"
              onChange={(e) => onChange(updateMovingAverage(s, i, { type: e.target.value as 'SMA' | 'EMA' }))}
            >
              <option>SMA</option>
              <option>EMA</option>
            </select>
            <NumberField
              label="Period"
              value={ma.period}
              parse={parsePeriod}
              onChange={(period) => onChange(updateMovingAverage(s, i, { period }))}
            />
            <button
              className="small"
              onClick={() => onChange(removeMovingAverage(s, i))}
              aria-label={`Remove ${ma.type} ${ma.period}`}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={() => onChange(addMovingAverage(s))}>Add moving average</button>
      </fieldset>
      <fieldset>
        <legend>Bollinger Bands</legend>
        <NumberField
          label="Period"
          value={s.bollinger.period}
          parse={parsePeriod}
          onChange={(period) => onChange({ ...s, bollinger: { ...s.bollinger, period } })}
        />
        <NumberField
          label="Std dev"
          value={s.bollinger.stdDev}
          parse={parsePositive}
          step="0.1"
          onChange={(stdDev) => onChange({ ...s, bollinger: { ...s.bollinger, stdDev } })}
        />
      </fieldset>
      <fieldset>
        <legend>RSI</legend>
        <NumberField
          label="Period"
          value={s.rsi.period}
          parse={parsePeriod}
          onChange={(period) => onChange({ ...s, rsi: { ...s.rsi, period } })}
        />
      </fieldset>
      <fieldset>
        <legend>MACD</legend>
        {(['fast', 'slow', 'signal'] as const).map((key) => (
          <NumberField
            key={key}
            label={key[0].toUpperCase() + key.slice(1)}
            value={s.macd[key]}
            parse={parsePeriod}
            onChange={(value) => onChange({ ...s, macd: { ...s.macd, [key]: value } })}
          />
        ))}
      </fieldset>
    </div>
  )
}

type FieldProps = {
  label: string
  value: number
  parse: (text: string) => number | null
  step?: string
  onChange: (value: number) => void
}

/** Keeps what is typed locally and only reports values the server would accept. */
function NumberField({ label, value, parse, step = '1', onChange }: FieldProps) {
  const [text, setText] = useState(String(value))
  return (
    <label className="field">
      {label}
      <input
        type="number"
        min={step}
        step={step}
        className={parse(text) === null ? 'invalid' : ''}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = parse(e.target.value)
          if (parsed !== null && parsed !== value) onChange(parsed)
        }}
      />
    </label>
  )
}
