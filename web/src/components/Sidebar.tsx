import { useState, type FormEvent } from 'react'
import { api, type Watchlist, type WatchlistItem } from '../api'
import { formatPct, formatPrice, staleDate } from '../format'
import { usePersistentState } from '../usePersistentState'

type Run = (action: Promise<unknown>) => Promise<unknown>

type Props = {
  watchlists: Watchlist[]
  selectedSymbolId: number | null
  onSelectSymbol: (id: number) => void
  run: Run
}

export function Sidebar({ watchlists, selectedSymbolId, onSelectSymbol, run }: Props) {
  const [collapsed, setCollapsed] = usePersistentState<number[]>('tickerdeck.collapsed', [])
  const [creating, setCreating] = useState(false)

  // Rebuilt from the lists that exist, so ids of deleted lists drop out on every write.
  const setListCollapsed = (id: number, value: boolean) =>
    setCollapsed(watchlists.map((w) => w.id).filter((wid) => (wid === id ? value : collapsed.includes(wid))))

  return (
    <aside className="sidebar">
      {creating ? (
        <NameForm
          initial=""
          onSave={(name) => {
            // The database can reuse the id of a deleted list, which may still be stored as collapsed.
            run(api.createWatchlist(name).then((w) => setListCollapsed(w.id, false)))
            setCreating(false)
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button onClick={() => setCreating(true)}>New list</button>
      )}
      {watchlists.length ? (
        <div className="lists">
          {watchlists.map((list) => (
            <ListSection
              key={list.id}
              list={list}
              collapsed={collapsed.includes(list.id)}
              onCollapse={(value) => setListCollapsed(list.id, value)}
              selectedSymbolId={selectedSymbolId}
              onSelectSymbol={onSelectSymbol}
              run={run}
            />
          ))}
        </div>
      ) : (
        <p className="hint">Create a list to start adding tickers.</p>
      )}
    </aside>
  )
}

type NameFormProps = {
  initial: string
  onSave: (name: string) => void
  onCancel: () => void
}

function NameForm({ initial, onSave, onCancel }: NameFormProps) {
  const [name, setName] = useState(initial)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSave(name)
  }

  return (
    <form className="row" onSubmit={submit}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="List name"
        aria-label="List name"
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

type SectionProps = {
  list: Watchlist
  collapsed: boolean
  onCollapse: (value: boolean) => void
  selectedSymbolId: number | null
  onSelectSymbol: (id: number) => void
  run: Run
}

function ListSection({ list, collapsed, onCollapse, selectedSymbolId, onSelectSymbol, run }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)

  return (
    <section className="list">
      {renaming ? (
        <NameForm
          initial={list.name}
          onSave={(name) => {
            run(api.renameWatchlist(list.id, name))
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div className="list-header">
          <button className="list-toggle" aria-expanded={!collapsed} onClick={() => onCollapse(!collapsed)}>
            <span className="muted">{collapsed ? '▸' : '▾'}</span>
            <span className="list-name">{list.name}</span>
            <span className="muted num">{list.items.length}</span>
          </button>
          <button
            className="small"
            onClick={() => {
              setAdding(collapsed || !adding)
              if (collapsed) onCollapse(false)
            }}
            aria-label={`Add tickers to ${list.name}`}
            title="Add tickers"
          >
            +
          </button>
          <button
            className="small"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${list.name}`}
            title="Rename"
          >
            ✎
          </button>
          <button
            className="small"
            onClick={() => {
              if (confirm(`Delete the list "${list.name}"?`)) run(api.deleteWatchlist(list.id))
            }}
            aria-label={`Delete ${list.name}`}
            title="Delete"
          >
            ×
          </button>
        </div>
      )}
      {!collapsed && (
        <>
          {adding && <AddBox listId={list.id} run={run} />}
          {list.items.length ? (
            <ul className="items">
              {list.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  selected={item.symbol.id === selectedSymbolId}
                  onSelect={() => onSelectSymbol(item.symbol.id)}
                  onRetry={() => run(api.retrySymbol(item.symbol.id))}
                  onRemove={() => run(api.removeItem(list.id, item.id))}
                />
              ))}
            </ul>
          ) : (
            <p className="hint">No tickers yet. Use + to add some.</p>
          )}
        </>
      )}
    </section>
  )
}

function AddBox({ listId, run }: { listId: number; run: Run }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setResult(null)
    run(
      api.addItems(listId, text).then(({ added, skipped }) => {
        setText('')
        setResult(`Added ${added}${skipped ? `, skipped ${skipped}` : ''}`)
      }),
    )
  }

  return (
    <form className="add-box" onSubmit={submit}>
      <div className="row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add ticker, or paste a list"
          aria-label="Add tickers"
        />
        <button type="submit">Add</button>
      </div>
      {result && <p className="hint">{result}</p>}
    </form>
  )
}

type RowProps = {
  item: WatchlistItem
  selected: boolean
  onSelect: () => void
  onRetry: () => void
  onRemove: () => void
}

function ItemRow({ item, selected, onSelect, onRetry, onRemove }: RowProps) {
  const { symbol, lastClose, changePct } = item
  const stale = staleDate(item.lastDate, Date.now())
  return (
    <li className={`item${selected ? ' selected' : ''}`}>
      <button className="item-main" onClick={onSelect}>
        <span className="ticker">{symbol.ticker}</span>
        {symbol.status === 'pending' && <span className="muted">loading</span>}
        {symbol.status === 'error' && <span className="down item-error">{symbol.error ?? 'Error'}</span>}
        {symbol.status === 'ready' && (
          <>
            {stale && (
              <span className="stale-date" title="Date of the last close">
                {stale}
              </span>
            )}
            <span className="num">{lastClose === null ? '—' : formatPrice(lastClose)}</span>
            <span className={`num pct ${changePct !== null && changePct < 0 ? 'down' : 'up'}`}>
              {changePct === null ? '' : formatPct(changePct)}
            </span>
          </>
        )}
      </button>
      {symbol.status === 'error' && (
        <button className="small" onClick={onRetry}>
          Retry
        </button>
      )}
      <button className="small" onClick={onRemove} aria-label={`Remove ${symbol.ticker}`} title="Remove">
        ×
      </button>
    </li>
  )
}
