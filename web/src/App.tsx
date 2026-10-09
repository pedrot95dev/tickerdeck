import { useCallback, useEffect, useState } from 'react'
import { api, TIMEFRAMES, type IndicatorSettings, type Timeframe, type Watchlist } from './api'
import { ChartPanel } from './components/ChartPanel'
import { Sidebar } from './components/Sidebar'
import { pollInterval } from './settings'
import { usePersistentState } from './usePersistentState'

export function App() {
  const [watchlists, setWatchlists] = useState<Watchlist[] | null>(null)
  const [settings, setSettings] = useState<IndicatorSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbolId, setSymbolId] = usePersistentState<number | null>('tickerdeck.symbol', null)
  const [storedTf, setTf] = usePersistentState<Timeframe>('tickerdeck.tf', 'D')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const tf = TIMEFRAMES.includes(storedTf) ? storedTf : 'D'

  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), [])
  const reload = useCallback(() => api.getWatchlists().then(setWatchlists, fail), [fail])
  const run = useCallback((action: Promise<unknown>) => action.catch(fail).then(reload), [fail, reload])

  useEffect(() => {
    reload()
    api.getSettings().then(setSettings, fail)
  }, [reload, fail])

  const interval = pollInterval(watchlists ?? [])
  useEffect(() => {
    const id = setInterval(reload, interval)
    return () => clearInterval(id)
  }, [interval, reload])

  const saveSettings = useCallback(
    (next: IndicatorSettings) => {
      setSettings(next)
      api.putSettings(next).catch(fail)
    },
    [fail],
  )

  if (!watchlists || !settings) {
    return <div className="placeholder">{error ?? 'Loading…'}</div>
  }

  const item = watchlists.flatMap((w) => w.items).find((i) => i.symbol.id === symbolId)

  return (
    <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
      <Sidebar
        watchlists={watchlists}
        selectedSymbolId={symbolId}
        onSelectSymbol={(id) => {
          setSymbolId(id)
          setSidebarOpen(false)
        }}
        run={run}
      />
      <main>
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? 'Hide lists' : 'Lists'}
        </button>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {item ? (
          <ChartPanel
            key={item.symbol.id}
            symbol={item.symbol}
            lastDate={item.lastDate}
            tf={tf}
            onTf={setTf}
            settings={settings}
            onSettings={saveSettings}
            onError={fail}
          />
        ) : (
          <div className="placeholder">Select a ticker from the list.</div>
        )}
      </main>
    </div>
  )
}
