const CRYPTO_PREFIXES = new Set([
  'BINANCE', 'BYBIT', 'COINBASE', 'KRAKEN', 'BITSTAMP', 'CRYPTO', 'CRYPTOCAP',
])

export type ResolvedTicker = { source: 'tiingo' | 'binance'; ticker: string }

function resolveToken(token: string): ResolvedTicker | null {
  const colon = token.indexOf(':')
  const prefix = colon >= 0 ? token.slice(0, colon) : null
  const ticker = token.slice(colon + 1)
  if (!ticker) return null

  const crypto = prefix === null ? /USDT?$/.test(ticker) : CRYPTO_PREFIXES.has(prefix)
  if (!crypto) return { source: 'tiingo', ticker: ticker.replaceAll('.', '-') }
  if (ticker.endsWith('USDT')) return { source: 'binance', ticker }
  if (ticker.endsWith('USD')) return { source: 'binance', ticker: `${ticker}T` }
  return { source: 'binance', ticker: `${ticker}USDT` }
}

/** `skipped` counts tokens with no ticker and repeats of an earlier token. */
export function resolveTickers(text: string): { tickers: ResolvedTicker[]; skipped: number } {
  const tickers: ResolvedTicker[] = []
  const seen = new Set<string>()
  let skipped = 0
  // Section headers ("###SECTION NAME") contain spaces, so split on commas and
  // newlines first and drop the whole segment before splitting on whitespace.
  for (const segment of text.split(/[,\r\n]+/)) {
    if (segment.trim().startsWith('###')) continue
    for (const token of segment.toUpperCase().split(/\s+/)) {
      if (!token) continue
      const resolved = resolveToken(token)
      const key = resolved ? `${resolved.source}:${resolved.ticker}` : ''
      if (!resolved || seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)
      tickers.push(resolved)
    }
  }
  return { tickers, skipped }
}
