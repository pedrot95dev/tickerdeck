import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { adjust, aggregate, changePct, type CandleRow } from './candles.js'
import type { Db } from './db.js'
import type { Market } from './market.js'
import { DEFAULT_INDICATOR_SETTINGS, parseIndicatorSettings } from './settings.js'
import { resolveTickers } from './tickers.js'

type SymbolRow = {
  id: number
  source: string
  ticker: string
  status: string
  error: string | null
  last_refreshed_at: string | null
}
type WatchlistRow = { id: number; name: string }
type LineRow = { id: number; price: number }
type IdParams = { Params: { id: string } }

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

const toSymbol = (r: SymbolRow) => ({
  id: r.id,
  source: r.source,
  ticker: r.ticker,
  status: r.status,
  error: r.error,
  lastRefreshedAt: r.last_refreshed_at,
})

const bodyOf = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>

function parseName(body: Record<string, unknown>): string {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw new HttpError(400, 'Name is required')
  return name
}

function positivePrice(price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new HttpError(400, 'Price must be a positive number')
  }
  return price
}

const parsePrice = (body: Record<string, unknown>) => positivePrice(body.price)

function validDate(date: unknown): string {
  const time = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN
  // Date.parse rolls 2025-02-30 over into March instead of rejecting it.
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'Date must be a valid YYYY-MM-DD date')
  }
  return date as string
}

function parseRange(body: Record<string, unknown>) {
  return {
    fromDate: validDate(body.fromDate),
    fromPrice: positivePrice(body.fromPrice),
    toDate: validDate(body.toDate),
    toPrice: positivePrice(body.toPrice),
  }
}

export function buildApp(
  db: Db,
  opts: { webDir?: string; logger?: boolean; market?: Pick<Market, 'refreshIfStale'> } = {},
): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false })

  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500) app.log.error(err)
    reply.status(status).send({ error: status >= 500 ? 'Internal server error' : err.message })
  })
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }))

  const getWatchlist = (id: string): WatchlistRow => {
    const row = db.prepare('SELECT id, name FROM watchlists WHERE id = ?').get(id) as WatchlistRow | undefined
    if (!row) throw new HttpError(404, 'Watchlist not found')
    return row
  }
  const getSymbol = (id: string): SymbolRow => {
    const row = db.prepare('SELECT * FROM symbols WHERE id = ?').get(id) as SymbolRow | undefined
    if (!row) throw new HttpError(404, 'Symbol not found')
    return row
  }
  const getLine = (id: string): LineRow => {
    const row = db.prepare('SELECT id, price FROM lines WHERE id = ?').get(id) as LineRow | undefined
    if (!row) throw new HttpError(404, 'Line not found')
    return row
  }

  const withItems = (w: WatchlistRow) => {
    const rows = db
      .prepare(
        `SELECT wi.id AS item_id, s.* FROM watchlist_items wi
         JOIN symbols s ON s.id = wi.symbol_id
         WHERE wi.watchlist_id = ? ORDER BY wi.position, wi.id`,
      )
      .all(w.id) as (SymbolRow & { item_id: number })[]
    const lastTwo = db.prepare('SELECT * FROM candles WHERE symbol_id = ? ORDER BY date DESC LIMIT 2')
    return {
      id: w.id,
      name: w.name,
      items: rows.map((row) => {
        const candles = adjust((lastTwo.all(row.id) as CandleRow[]).reverse())
        const last = candles.at(-1)
        return {
          id: row.item_id,
          symbol: toSymbol(row),
          lastClose: last?.close ?? null,
          changePct: changePct(candles),
          lastDate: last?.time ?? null,
        }
      }),
    }
  }

  const deleteOrphanSymbols = () =>
    db.prepare('DELETE FROM symbols WHERE id NOT IN (SELECT symbol_id FROM watchlist_items)').run()

  app.register(
    async (api) => {
      api.get('/watchlists', () =>
        (db.prepare('SELECT id, name FROM watchlists ORDER BY position, id').all() as WatchlistRow[]).map(withItems),
      )

      api.post('/watchlists', (req, reply) => {
        const name = parseName(bodyOf(req))
        const { lastInsertRowid } = db
          .prepare('INSERT INTO watchlists(name, position) SELECT ?, COALESCE(MAX(position), 0) + 1 FROM watchlists')
          .run(name)
        reply.status(201)
        return { id: Number(lastInsertRowid), name, items: [] }
      })

      api.patch<IdParams>('/watchlists/:id', (req) => {
        const watchlist = getWatchlist(req.params.id)
        const name = parseName(bodyOf(req))
        db.prepare('UPDATE watchlists SET name = ? WHERE id = ?').run(name, watchlist.id)
        return withItems({ ...watchlist, name })
      })

      api.delete<IdParams>('/watchlists/:id', (req, reply) => {
        const watchlist = getWatchlist(req.params.id)
        db.transaction(() => {
          db.prepare('DELETE FROM watchlists WHERE id = ?').run(watchlist.id)
          deleteOrphanSymbols()
        })()
        reply.status(204).send()
      })

      api.post<IdParams>('/watchlists/:id/items', (req) => {
        const watchlist = getWatchlist(req.params.id)
        const { text } = bodyOf(req)
        if (typeof text !== 'string') throw new HttpError(400, 'Text is required')
        const { tickers, skipped } = resolveTickers(text)

        const insertSymbol = db.prepare('INSERT OR IGNORE INTO symbols(source, ticker) VALUES (?, ?)')
        const symbolId = db.prepare('SELECT id FROM symbols WHERE source = ? AND ticker = ?').pluck()
        const insertItem = db.prepare(
          `INSERT OR IGNORE INTO watchlist_items(watchlist_id, symbol_id, position)
           SELECT @list, @symbol, COALESCE(MAX(position), 0) + 1 FROM watchlist_items WHERE watchlist_id = @list`,
        )
        let added = 0
        db.transaction(() => {
          for (const { source, ticker } of tickers) {
            insertSymbol.run(source, ticker)
            added += insertItem.run({ list: watchlist.id, symbol: symbolId.get(source, ticker) }).changes
          }
        })()
        return { added, skipped: skipped + tickers.length - added }
      })

      api.delete<{ Params: { id: string; itemId: string } }>('/watchlists/:id/items/:itemId', (req, reply) => {
        const watchlist = getWatchlist(req.params.id)
        db.transaction(() => {
          const { changes } = db
            .prepare('DELETE FROM watchlist_items WHERE id = ? AND watchlist_id = ?')
            .run(req.params.itemId, watchlist.id)
          if (!changes) throw new HttpError(404, 'Item not found')
          deleteOrphanSymbols()
        })()
        reply.status(204).send()
      })

      api.post<IdParams>('/symbols/:id/retry', (req, reply) => {
        const symbol = getSymbol(req.params.id)
        db.prepare("UPDATE symbols SET status = 'pending', error = NULL WHERE id = ? AND status = 'error'").run(
          symbol.id,
        )
        reply.status(204).send()
      })

      api.get<IdParams & { Querystring: { tf?: string } }>('/symbols/:id/candles', async (req) => {
        let symbol = getSymbol(req.params.id)
        const tf = req.query.tf ?? 'D'
        if (tf !== 'D' && tf !== 'W' && tf !== 'M') throw new HttpError(400, 'tf must be D, W or M')
        if (opts.market) {
          await opts.market.refreshIfStale(symbol.id)
          symbol = getSymbol(req.params.id)
        }
        const rows = db.prepare('SELECT * FROM candles WHERE symbol_id = ? ORDER BY date').all(symbol.id) as CandleRow[]
        return { symbol: toSymbol(symbol), candles: aggregate(adjust(rows), tf) }
      })

      api.get<IdParams>('/symbols/:id/lines', (req) => {
        const symbol = getSymbol(req.params.id)
        return db.prepare('SELECT id, price FROM lines WHERE symbol_id = ? ORDER BY id').all(symbol.id)
      })

      api.post<IdParams>('/symbols/:id/lines', (req, reply) => {
        const symbol = getSymbol(req.params.id)
        const price = parsePrice(bodyOf(req))
        const { lastInsertRowid } = db.prepare('INSERT INTO lines(symbol_id, price) VALUES (?, ?)').run(symbol.id, price)
        reply.status(201)
        return { id: Number(lastInsertRowid), price }
      })

      api.patch<IdParams>('/lines/:id', (req) => {
        const line = getLine(req.params.id)
        const price = parsePrice(bodyOf(req))
        db.prepare('UPDATE lines SET price = ? WHERE id = ?').run(price, line.id)
        return { id: line.id, price }
      })

      api.delete<IdParams>('/lines/:id', (req, reply) => {
        const line = getLine(req.params.id)
        db.prepare('DELETE FROM lines WHERE id = ?').run(line.id)
        reply.status(204).send()
      })

      api.get<IdParams>('/symbols/:id/ranges', (req) => {
        const symbol = getSymbol(req.params.id)
        return db
          .prepare(
            `SELECT id, from_date AS fromDate, from_price AS fromPrice, to_date AS toDate, to_price AS toPrice
             FROM ranges WHERE symbol_id = ? ORDER BY id`,
          )
          .all(symbol.id)
      })

      api.post<IdParams>('/symbols/:id/ranges', (req, reply) => {
        const symbol = getSymbol(req.params.id)
        const range = parseRange(bodyOf(req))
        const { lastInsertRowid } = db
          .prepare('INSERT INTO ranges(symbol_id, from_date, from_price, to_date, to_price) VALUES (?, ?, ?, ?, ?)')
          .run(symbol.id, range.fromDate, range.fromPrice, range.toDate, range.toPrice)
        reply.status(201)
        return { id: Number(lastInsertRowid), ...range }
      })

      api.delete<IdParams>('/ranges/:id', (req, reply) => {
        const { changes } = db.prepare('DELETE FROM ranges WHERE id = ?').run(req.params.id)
        if (!changes) throw new HttpError(404, 'Range not found')
        reply.status(204).send()
      })

      api.get('/settings/indicators', () => {
        const value = db.prepare("SELECT value FROM settings WHERE key = 'indicators'").pluck().get() as
          | string
          | undefined
        return value ? JSON.parse(value) : DEFAULT_INDICATOR_SETTINGS
      })

      api.put('/settings/indicators', (req) => {
        const settings = parseIndicatorSettings(req.body)
        if (!settings) throw new HttpError(400, 'Invalid indicator settings')
        db.prepare(
          "INSERT INTO settings(key, value) VALUES ('indicators', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(JSON.stringify(settings))
        return settings
      })
    },
    { prefix: '/api' },
  )

  if (opts.webDir) app.register(fastifyStatic, { root: opts.webDir })

  return app
}
