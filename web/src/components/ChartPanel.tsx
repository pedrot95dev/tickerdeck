import { useEffect, useState } from 'react'
import {
  api,
  TIMEFRAMES,
  type Candle,
  type IndicatorSettings,
  type Line,
  type Range,
  type RangePoints,
  type SymbolInfo,
  type Timeframe,
} from '../api'
import { formatDataTo, formatPrice, formatRange, pricePrecision } from '../format'
import { IndicatorToggles } from './IndicatorToggles'
import { PriceChart } from './PriceChart'
import { SettingsPanel } from './SettingsPanel'

type Props = {
  symbol: SymbolInfo
  lastDate: string | null
  tf: Timeframe
  onTf: (tf: Timeframe) => void
  settings: IndicatorSettings
  onSettings: (settings: IndicatorSettings) => void
  onError: (e: unknown) => void
  /** The server stored a quote the watchlists do not show yet. */
  onQuote: () => void
}

/** Rendered with `key={symbol.id}`, so all state here belongs to one symbol. */
export function ChartPanel({ symbol, lastDate, tf, onTf, settings, onSettings, onError, onQuote }: Props) {
  const [loaded, setLoaded] = useState<{ tf: Timeframe; candles: Candle[] } | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [ranges, setRanges] = useState<Range[]>([])
  const [mode, setMode] = useState<'line' | 'measure' | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // lastRefreshedAt and quotedAt are dependencies so that a refresh seen by the sidebar poll reloads the chart.
  // Reading the candles of a stock can itself store a quote; the watchlists are then reloaded at once, so that
  // the sidebar and the header show it and the next poll finds nothing new (a reload on a timer would turn
  // into a quote request on a timer).
  useEffect(() => {
    if (symbol.status !== 'ready') return
    let stale = false
    api.getCandles(symbol.id, tf).then((r) => {
      if (stale) return
      setLoaded({ tf, candles: r.candles })
      if (r.symbol.quotedAt !== symbol.quotedAt) onQuote()
    }, onError)
    return () => {
      stale = true
    }
  }, [symbol.id, symbol.status, symbol.lastRefreshedAt, symbol.quotedAt, tf, onError, onQuote])

  useEffect(() => {
    api.getLines(symbol.id).then(setLines, onError)
  }, [symbol.id, onError])

  useEffect(() => {
    api.getRanges(symbol.id).then(setRanges, onError)
  }, [symbol.id, onError])

  useEffect(() => {
    if (mode !== 'measure') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  const candles = loaded?.tf === tf ? loaded.candles : null
  const precision = pricePrecision(candles?.at(-1)?.close ?? 1)
  const round = (price: number) => Number(price.toFixed(precision))

  const addLine = (price: number) => {
    setMode(null)
    api.addLine(symbol.id, round(price)).then((line) => setLines((ls) => [...ls, line]), onError)
  }
  const moveLine = (id: number, price: number) => {
    const rounded = round(price)
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, price: rounded } : l)))
    api.moveLine(id, rounded).catch((e) => {
      onError(e)
      api.getLines(symbol.id).then(setLines, onError)
    })
  }
  const deleteLine = (id: number) => {
    api.deleteLine(id).then(() => setLines((ls) => ls.filter((l) => l.id !== id)), onError)
  }
  const addRange = (range: RangePoints) => {
    setMode(null)
    const rounded = { ...range, fromPrice: round(range.fromPrice), toPrice: round(range.toPrice) }
    api.addRange(symbol.id, rounded).then((saved) => setRanges((rs) => [...rs, saved]), onError)
  }
  const deleteRange = (id: number) => {
    api.deleteRange(id).then(() => setRanges((rs) => rs.filter((r) => r.id !== id)), onError)
  }

  let body
  if (symbol.status === 'pending') body = <div className="placeholder">Downloading price history…</div>
  else if (symbol.status === 'error') body = <div className="placeholder down">{symbol.error ?? 'Error'}</div>
  else if (!candles) body = <div className="placeholder">Loading…</div>
  else if (candles.length === 0) body = <div className="placeholder">No price data.</div>
  else
    body = (
      <PriceChart
        candles={candles}
        settings={settings}
        lines={lines}
        ranges={ranges}
        mode={mode}
        onAddLine={addLine}
        onMoveLine={moveLine}
        onAddRange={addRange}
      />
    )

  return (
    <section className="chart-panel">
      <header className="chart-header">
        <h1>{symbol.ticker}</h1>
        <span className="muted">{formatDataTo(lastDate, symbol.quotedAt)}</span>
        <div className="group timeframes">
          {TIMEFRAMES.map((t) => (
            <button key={t} className={t === tf ? 'active' : ''} aria-pressed={t === tf} onClick={() => onTf(t)}>
              {t}
            </button>
          ))}
        </div>
      </header>
      <div className="toolbar">
        <IndicatorToggles settings={settings} onChange={onSettings} />
        <button className={showSettings ? 'active' : ''} onClick={() => setShowSettings(!showSettings)}>
          Settings
        </button>
      </div>
      {showSettings && <SettingsPanel settings={settings} onChange={onSettings} />}
      <div className="toolbar">
        <button
          className={mode === 'line' ? 'active' : ''}
          disabled={!candles?.length}
          onClick={() => setMode(mode === 'line' ? null : 'line')}
        >
          {mode === 'line' ? 'Click the chart… (cancel)' : 'Add line'}
        </button>
        <button
          className={mode === 'measure' ? 'active' : ''}
          disabled={!candles?.length}
          onClick={() => setMode(mode === 'measure' ? null : 'measure')}
        >
          {mode === 'measure' ? 'Click two points… (cancel)' : 'Measure'}
        </button>
        {lines.map((line) => (
          <span key={line.id} className="line-chip">
            {formatPrice(line.price, precision)}
            <button
              className="small"
              onClick={() => deleteLine(line.id)}
              aria-label={`Delete line at ${formatPrice(line.price, precision)}`}
              title="Delete line"
            >
              ×
            </button>
          </span>
        ))}
        {ranges.map((range) => {
          const label = formatRange(range.fromPrice, range.toPrice, precision)
          return (
            <span key={range.id} className={`line-chip range-chip ${range.toPrice >= range.fromPrice ? 'up' : 'down'}`}>
              {label}
              <button
                className="small"
                onClick={() => deleteRange(range.id)}
                aria-label={`Delete measurement ${label}`}
                title="Delete measurement"
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
      {body}
    </section>
  )
}
