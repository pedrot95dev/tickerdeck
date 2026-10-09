export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type Point = { time: string; value: number };

// Result i belongs to input index i + period - 1.
function emaValues(values: number[], period: number): number[] {
  if (period < 1 || values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev += k * (values[i] - prev);
    out.push(prev);
  }
  return out;
}

export function sma(candles: Candle[], period: number): Point[] {
  return bollinger(candles, period, 0).map(({ time, middle }) => ({ time, value: middle }));
}

export function ema(candles: Candle[], period: number): Point[] {
  return emaValues(candles.map((c) => c.close), period).map((value, i) => ({
    time: candles[i + period - 1].time,
    value,
  }));
}

export function bollinger(
  candles: Candle[],
  period: number,
  stdDev: number,
): { time: string; upper: number; middle: number; lower: number }[] {
  if (period < 1 || candles.length < period) return [];
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    // Each window is computed from its own closes, relative to its first one: a running update
    // carries the rounding error of earlier, much larger prices, and flat data must stay exact.
    const base = candles[i - period + 1].close;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close - base;
    const mean = sum / period;
    let squares = 0;
    for (let j = i - period + 1; j <= i; j++) squares += (candles[j].close - base - mean) ** 2;
    const middle = base + mean;
    const width = stdDev * Math.sqrt(squares / period);
    out.push({ time: candles[i].time, upper: middle + width, middle, lower: middle - width });
  }
  return out;
}

export function rsi(candles: Candle[], period: number): Point[] {
  if (period < 1) return [];
  const out: Point[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    // No losses (including a flat series) reads 100, as TradingView's ta.rsi does.
    if (i >= period) out.push({ time: candles[i].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}

export function macd(
  candles: Candle[],
  fast: number,
  slow: number,
  signal: number,
): { time: string; macd: number; signal: number; histogram: number }[] {
  if (fast < 1 || slow < 1) return [];
  const closes = candles.map((c) => c.close);
  const fastEma = emaValues(closes, fast);
  const slowEma = emaValues(closes, slow);
  const start = Math.max(fast, slow) - 1;
  const line: number[] = [];
  for (let i = start; i < closes.length; i++) line.push(fastEma[i - fast + 1] - slowEma[i - slow + 1]);
  return emaValues(line, signal).map((signalValue, i) => {
    const value = line[i + signal - 1];
    return {
      time: candles[start + i + signal - 1].time,
      macd: value,
      signal: signalValue,
      histogram: value - signalValue,
    };
  });
}
