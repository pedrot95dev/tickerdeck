import { useState, type DragEvent, type FormEvent } from 'react'
import { api, type Watchlist, type WatchlistItem } from '../api'
import { formatPct, formatPrice, staleDate } from '../format'
import { moveTo } from '../reorder'
import { usePersistentState } from '../usePersistentState'

type Run = (action: Promise<unknown>) => Promise<unknown>

/** The row being dragged: a list, or a ticker that can only move within its own list. */
type Dragged = { listId: number; itemId?: number }
type Dnd = {
  dragged: Dragged | null
  overId: number | null
  start: (dragged: Dragged) => void
  over: (id: number | null) => void
  end: () => void
}

/**
 * Makes the row `id` a place to drop the dragged row `draggedId`, one of its siblings `ids`
 * (null when the dragged row is not a sibling). `marker` is the class showing where it would land.
 */
function dropTarget(dnd: Dnd, ids: number[], draggedId: number | null, id: number, onMove: (ids: number[]) => void) {
  if (draggedId === null || draggedId === id) return { marker: '' }
  const accept = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dnd.over(id)
  }
  return {
    marker: dnd.overId !== id ? '' : ids.indexOf(draggedId) < ids.indexOf(id) ? ' drop-after' : ' drop-before',
    onDragEnter: accept,
    onDragOver: accept,
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dnd.over(null)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      onMove(moveTo(ids, draggedId, id))
      dnd.end()
    },
  }
}

/** A handle rather than the whole row: Firefox does not start a drag from a button. */
function Grip({ label, onStart, onEnd }: { label: string; onStart: () => void; onEnd: () => void }) {
  return (
    <span
      className="grip"
      draggable
      title="Drag to reorder"
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', label)
        if (e.currentTarget.parentElement) e.dataTransfer.setDragImage(e.currentTarget.parentElement, 0, 0)
        onStart()
      }}
      onDragEnd={onEnd}
    >
      ⠿
    </span>
  )
}

type Props = {
  watchlists: Watchlist[]
  selectedSymbolId: number | null
  onSelectSymbol: (id: number) => void
  run: Run
}

export function Sidebar({ watchlists, selectedSymbolId, onSelectSymbol, run }: Props) {
  const [collapsed, setCollapsed] = usePersistentState<number[]>('tickerdeck.collapsed', [])
  const [creating, setCreating] = useState(false)
  const [dragged, setDragged] = useState<Dragged | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const dnd: Dnd = {
    dragged,
    overId,
    start: setDragged,
    over: setOverId,
    end: () => {
      setDragged(null)
      setOverId(null)
    },
  }
  const listIds = watchlists.map((w) => w.id)

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
              dnd={dnd}
              drop={dropTarget(dnd, listIds, dragged && dragged.itemId === undefined ? dragged.listId : null, list.id, (ids) =>
                run(api.reorderWatchlists(ids)),
              )}
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
  dnd: Dnd
  drop: ReturnType<typeof dropTarget>
}

function ListSection({ list, collapsed, onCollapse, selectedSymbolId, onSelectSymbol, run, dnd, drop }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const { marker, ...dropHandlers } = drop
  const itemIds = list.items.map((i) => i.id)
  const draggedItemId = dnd.dragged?.listId === list.id ? (dnd.dragged.itemId ?? null) : null

  return (
    <section className={`list${marker}`} {...dropHandlers}>
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
          <Grip label={list.name} onStart={() => dnd.start({ listId: list.id })} onEnd={dnd.end} />
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
                  onDragStart={() => dnd.start({ listId: list.id, itemId: item.id })}
                  onDragEnd={dnd.end}
                  drop={dropTarget(dnd, itemIds, draggedItemId, item.id, (ids) => run(api.reorderItems(list.id, ids)))}
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
  onDragStart: () => void
  onDragEnd: () => void
  drop: ReturnType<typeof dropTarget>
}

function ItemRow({ item, selected, onSelect, onRetry, onRemove, onDragStart, onDragEnd, drop }: RowProps) {
  const { symbol, lastClose, changePct } = item
  const stale = staleDate(item.lastDate, Date.now())
  const { marker, ...dropHandlers } = drop
  return (
    <li className={`item${selected ? ' selected' : ''}${marker}`} {...dropHandlers}>
      <Grip label={symbol.ticker} onStart={onDragStart} onEnd={onDragEnd} />
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
