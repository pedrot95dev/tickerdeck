import { expect, test } from 'vitest'
import { resolveTickers } from '../src/tickers.js'

const tiingo = (ticker: string) => ({ source: 'tiingo', ticker })
const binance = (ticker: string) => ({ source: 'binance', ticker })

test('resolves a TradingView export and drops ### sections, including ones with spaces', () => {
  const { tickers, skipped } = resolveTickers('NASDAQ:AAPL,BINANCE:BTCUSDT,###SECTION NAME,NYSE:KO')
  expect(tickers).toEqual([tiingo('AAPL'), binance('BTCUSDT'), tiingo('KO')])
  expect(skipped).toBe(0)
})

test('splits on commas, whitespace and newlines and uppercases', () => {
  expect(resolveTickers('aapl, msft\nko\r\n  nvda\ttsla').tickers).toEqual(
    ['AAPL', 'MSFT', 'KO', 'NVDA', 'TSLA'].map(tiingo),
  )
})

test('crypto prefixes resolve to the Binance USDT pair', () => {
  const text = 'BINANCE:ETHUSDT BYBIT:SOLUSD COINBASE:BTCUSD KRAKEN:ADA BITSTAMP:XRPUSD CRYPTO:DOT CRYPTOCAP:LINK'
  expect(resolveTickers(text).tickers).toEqual(
    ['ETHUSDT', 'SOLUSDT', 'BTCUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'LINKUSDT'].map(binance),
  )
})

test('unprefixed tickers ending in USD or USDT are crypto', () => {
  expect(resolveTickers('BTCUSD, solusdt').tickers).toEqual([binance('BTCUSDT'), binance('SOLUSDT')])
})

test('any other prefix is a stock, even when the ticker ends in USD', () => {
  expect(resolveTickers('NYSE:XYZUSD').tickers).toEqual([tiingo('XYZUSD')])
})

test('stock tickers use - where TradingView uses .', () => {
  expect(resolveTickers('BRK.B NYSE:BF.B').tickers).toEqual([tiingo('BRK-B'), tiingo('BF-B')])
})

test('duplicates after normalisation and tokens without a ticker are skipped', () => {
  const { tickers, skipped } = resolveTickers('AAPL, NASDAQ:AAPL, BTCUSD, BINANCE:BTCUSDT, NYSE:')
  expect(tickers).toEqual([tiingo('AAPL'), binance('BTCUSDT')])
  expect(skipped).toBe(3)
})

test('blank input resolves to nothing', () => {
  expect(resolveTickers(' ,\n, ')).toEqual({ tickers: [], skipped: 0 })
})
