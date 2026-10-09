import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { openDb } from './db.js'
import { createMarket } from './market.js'

const TICK_MS = 5_000

const dataDir = process.env.DATA_DIR || './data'
mkdirSync(dataDir, { recursive: true })
const db = openDb(join(dataDir, 'tickerdeck.db'))

const market = createMarket(db, {
  fetch,
  now: Date.now,
  token: process.env.TIINGO_API_TOKEN || undefined,
  log: (message) => app.log.warn(message),
})

const webDir = fileURLToPath(new URL('../../web/dist', import.meta.url))
const app = buildApp(db, { logger: true, webDir: existsSync(webDir) ? webDir : undefined, market })

await app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })

void market.tick()
setInterval(() => void market.tick(), TICK_MS)

// Node as PID 1 in a container ignores SIGTERM unless it is handled.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => app.close().then(() => process.exit(0)))
}
