import { describe, expect, it } from "vitest";
import { bollinger, ema, macd, rsi, sma, type Candle } from "./index";

const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: `t${i}`, open: close, high: close, low: close, close, volume: 0 }));

const expectNear = (actual: number[], expected: number[], tolerance: number) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i]), `index ${i}: ${value} vs ${expected[i]}`).toBeLessThanOrEqual(tolerance));
};

// The published sheets compute from unrounded prices but print closes and results to 2 decimals:
// up to 0.005 from the rounded inputs plus 0.005 from the printed result.
const PRINTED = 0.0101;

// StockCharts ChartSchool, "Moving Averages - Simple and Exponential", Intel 10-day SMA/EMA spreadsheet (24-Mar-10 to 5-May-10).
const INTC = [
  22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39, 22.38, 22.61, 23.36,
  24.05, 23.75, 23.83, 23.95, 23.63, 23.82, 23.87, 23.65, 23.19, 23.1, 23.33, 22.68, 23.1, 22.4, 22.17,
];
const INTC_SMA10 = [
  22.22, 22.21, 22.23, 22.26, 22.31, 22.42, 22.61, 22.77, 22.91, 23.08, 23.21, 23.38, 23.53, 23.65, 23.71,
  23.69, 23.61, 23.51, 23.43, 23.28, 23.13,
];
const INTC_EMA10 = [
  22.22, 22.21, 22.24, 22.27, 22.33, 22.52, 22.8, 22.97, 23.13, 23.28, 23.34, 23.43, 23.51, 23.54, 23.47,
  23.4, 23.39, 23.26, 23.23, 23.08, 22.92,
];

// StockCharts ChartSchool, "Bollinger Bands", SPY Bollinger Bands (20,2) spreadsheet (29-May-09 to 30-Jun-09).
const SPY = [
  90.7, 92.9, 92.98, 91.8, 92.66, 92.68, 92.3, 92.77, 92.54, 92.95, 93.2, 91.07, 89.83, 89.74, 90.4, 90.74,
  88.02, 88.09, 88.84, 90.78, 90.54, 91.39, 90.65,
];

// StockCharts ChartSchool, "Relative Strength Index (RSI)", QQQQ 14-day RSI spreadsheet (14-Dec-09 to 1-Feb-10).
const QQQQ = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
  46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  43.42, 42.66, 43.13,
];
const QQQQ_RSI14 = [
  70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87,
  45.46, 37.3, 33.08, 37.77,
];

describe("sma", () => {
  it("matches a hand-computed case", () => {
    // (1+2+3)/3, (2+3+4)/3, (3+4+5)/3
    expect(sma(candles([1, 2, 3, 4, 5]), 3)).toEqual([
      { time: "t2", value: 2 },
      { time: "t3", value: 3 },
      { time: "t4", value: 4 },
    ]);
  });

  it("matches the published Intel 10-day SMA", () => {
    const result = sma(candles(INTC), 10);
    expectNear(result.map((p) => p.value), INTC_SMA10, PRINTED);
    expect(result[0].time).toBe("t9");
    expect(result.at(-1)!.time).toBe("t29");
  });

  it("returns nothing below the period and one value at exactly the period", () => {
    expect(sma(candles([1, 2]), 3)).toEqual([]);
    expect(sma([], 3)).toEqual([]);
    expect(sma(candles([1, 2, 6]), 3)).toEqual([{ time: "t2", value: 3 }]);
  });
});

describe("ema", () => {
  it("matches a hand-computed case", () => {
    // multiplier 2/4 = 0.5; seed (1+2+3)/3 = 2; 2 + 0.5*(10-2) = 6; 6 + 0.5*(4-6) = 5
    expect(ema(candles([1, 2, 3, 10, 4]), 3)).toEqual([
      { time: "t2", value: 2 },
      { time: "t3", value: 6 },
      { time: "t4", value: 5 },
    ]);
  });

  it("matches the published Intel 10-day EMA", () => {
    const result = ema(candles(INTC), 10);
    expectNear(result.map((p) => p.value), INTC_EMA10, PRINTED);
    expect(result[0].time).toBe("t9");
  });

  it("returns nothing below the period and the SMA seed at exactly the period", () => {
    expect(ema(candles([1, 2]), 3)).toEqual([]);
    expect(ema(candles([1, 2, 6]), 3)).toEqual([{ time: "t2", value: 3 }]);
  });
});

describe("bollinger", () => {
  it("uses the population standard deviation (hand-computed)", () => {
    // 2,4,4,4,5,5,7,9: mean 5, squared deviations sum 32, population sd sqrt(32/8) = 2 (sample sd would be 2.138).
    // Next window 4,4,4,5,5,7,9,2: mean 5, squared deviations sum 32, sd 2.
    expect(bollinger(candles([2, 4, 4, 4, 5, 5, 7, 9, 2]), 8, 2)).toEqual([
      { time: "t7", upper: 9, middle: 5, lower: 1 },
      { time: "t8", upper: 9, middle: 5, lower: 1 },
    ]);
  });

  it("scales the band width by the multiplier", () => {
    expect(bollinger(candles([2, 4, 4, 4, 5, 5, 7, 9]), 8, 1.5)).toEqual([{ time: "t7", upper: 8, middle: 5, lower: 2 }]);
  });

  it("matches the published SPY (20,2) bands", () => {
    // Rows 25-Jun-09 to 30-Jun-09: the only rows whose full 20-day window is printed.
    const result = bollinger(candles(SPY), 20, 2);
    expect(result.map((b) => b.time)).toEqual(["t19", "t20", "t21", "t22"]);
    expectNear(result.map((b) => b.middle), [91.25, 91.24, 91.17, 91.05], PRINTED);
    expectNear(result.map((b) => (b.upper - b.middle) / 2), [1.64, 1.65, 1.6, 1.55], PRINTED);
    // Bands carry the input-rounding error of the mean plus twice that of the deviation.
    expectNear(result.map((b) => b.upper), [94.53, 94.53, 94.37, 94.15], 0.02);
    expectNear(result.map((b) => b.lower), [87.97, 87.95, 87.96, 87.95], 0.02);
  });

  it("collapses to the price on flat data, even at large prices", () => {
    const result = bollinger(candles(Array(50).fill(98765.43)), 20, 2);
    expect(result).toHaveLength(31);
    for (const band of result) expect(band).toEqual({ time: band.time, upper: 98765.43, middle: 98765.43, lower: 98765.43 });
  });

  it("keeps its width on a series that fell many orders of magnitude", () => {
    // 3,500 closes falling geometrically from 1e9 to 10.
    const closes = Array.from({ length: 3500 }, (_, i) => 1e9 * (10 / 1e9) ** (i / 3499));
    const result = bollinger(candles(closes), 20, 2);
    expect(result).toHaveLength(3481);
    // Every window computed directly from its own 20 closes.
    result.forEach((band, i) => {
      const window = closes.slice(i, i + 20);
      const mean = window.reduce((a, b) => a + b, 0) / 20;
      const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
      const tolerance = mean * 1e-9;
      expect(Math.abs(band.middle - mean), `middle ${i}`).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(band.upper - (mean + 2 * sd)), `upper ${i}`).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(band.lower - (mean - 2 * sd)), `lower ${i}`).toBeLessThanOrEqual(tolerance);
    });
    const last = result.at(-1)!;
    expect(last.upper).toBeCloseTo(11.1562, 4);
    expect(last.middle).toBeCloseTo(10.5177, 4);
    expect(last.lower).toBeCloseTo(9.8792, 4);
  });

  it("returns nothing below the period and one value at exactly the period", () => {
    expect(bollinger(candles([1, 2]), 3, 2)).toEqual([]);
    // 1,2,3: mean 2, population sd sqrt(2/3)
    const [only, ...rest] = bollinger(candles([1, 2, 3]), 3, 2);
    expect(rest).toEqual([]);
    expect(only.time).toBe("t2");
    expect(only.middle).toBe(2);
    expect(only.upper).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 12);
    expect(only.lower).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 12);
  });
});

describe("rsi", () => {
  it("matches a hand-computed case", () => {
    // changes +1, -1, +2, 0 with period 2
    // t2: avg gain 1/2, avg loss 1/2 -> RS 1 -> 50
    // t3: avg gain (1/2 + 2)/2 = 5/4, avg loss (1/2 + 0)/2 = 1/4 -> RS 5 -> 100 - 100/6
    // t4: avg gain 5/8, avg loss 1/8 -> RS 5 -> 100 - 100/6
    const result = rsi(candles([10, 11, 10, 12, 12]), 2);
    expect(result.map((p) => p.time)).toEqual(["t2", "t3", "t4"]);
    expectNear(result.map((p) => p.value), [50, 100 - 100 / 6, 100 - 100 / 6], 1e-12);
  });

  it("matches the first value hand-computed from the published QQQQ closes", () => {
    // First 14 changes: gains sum 3.34, losses sum 1.40 -> RS 3.34/1.40 -> 100 - 100/(1 + 3.34/1.40) = 70.4641
    expect(rsi(candles(QQQQ.slice(0, 15)), 14)).toEqual([{ time: "t14", value: expect.closeTo(70.4641, 4) }]);
  });

  it("matches the published QQQQ 14-day RSI", () => {
    // RSI amplifies the rounding of the printed closes, hence the looser tolerance.
    const result = rsi(candles(QQQQ), 14);
    expectNear(result.map((p) => p.value), QQQQ_RSI14, 0.1);
    expect(result[0].time).toBe("t14");
    expect(result.at(-1)!.time).toBe("t32");
  });

  it("is 100 with no losses, 0 with no gains, and 100 on flat prices", () => {
    expect(rsi(candles([1, 2, 3, 4]), 2).map((p) => p.value)).toEqual([100, 100]);
    expect(rsi(candles([4, 3, 2, 1]), 2).map((p) => p.value)).toEqual([0, 0]);
    expect(rsi(candles([5, 5, 5, 5]), 2).map((p) => p.value)).toEqual([100, 100]);
  });

  it("needs period + 1 candles", () => {
    expect(rsi(candles([1, 2]), 3)).toEqual([]);
    expect(rsi(candles([1, 2, 3]), 3)).toEqual([]);
    expect(rsi(candles([1, 2, 3, 4]), 3)).toEqual([{ time: "t3", value: 100 }]);
  });
});

describe("macd", () => {
  it("matches a hand-computed case", () => {
    // closes 1,2,3,5,8,13 with fast 2, slow 3, signal 2
    // EMA2 (k=2/3) from t1: 3/2, 5/2, 25/6, 121/18, 589/54
    // EMA3 (k=1/2) from t2: 2, 7/2, 23/4, 75/8
    // MACD from t2: 1/2, 2/3, 35/36, 331/216
    // signal (EMA2 of MACD, seed (1/2 + 2/3)/2) from t3: 7/12, 91/108, 211/162
    const result = macd(candles([1, 2, 3, 5, 8, 13]), 2, 3, 2);
    expect(result.map((p) => p.time)).toEqual(["t3", "t4", "t5"]);
    expectNear(result.map((p) => p.macd), [2 / 3, 35 / 36, 331 / 216], 1e-12);
    expectNear(result.map((p) => p.signal), [7 / 12, 91 / 108, 211 / 162], 1e-12);
    expectNear(result.map((p) => p.histogram), [1 / 12, 7 / 54, 149 / 648], 1e-12);
  });

  it("starts where the signal is defined", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(macd(candles(closes.slice(0, 33)), 12, 26, 9)).toEqual([]);
    expect(macd(candles(closes.slice(0, 34)), 12, 26, 9).map((p) => p.time)).toEqual(["t33"]);
    const result = macd(candles(closes), 12, 26, 9);
    expect(result).toHaveLength(7);
    expect(result[0].time).toBe("t33");
    expect(result.at(-1)!.time).toBe("t39");
    // On a straight line every EMA lags by a constant, so MACD is constant: (26-1)/2 - (12-1)/2 = 7, histogram 0.
    for (const p of result) {
      expect(p.macd).toBeCloseTo(7, 9);
      expect(p.signal).toBeCloseTo(7, 9);
      expect(p.histogram).toBeCloseTo(0, 9);
    }
  });

  it("is zero on flat prices", () => {
    expect(macd(candles(Array(34).fill(7)), 12, 26, 9)).toEqual([{ time: "t33", macd: 0, signal: 0, histogram: 0 }]);
  });
});

describe("all indicators", () => {
  it("do not mutate their input", () => {
    const input = candles(QQQQ);
    const frozen = input.map((c) => Object.freeze({ ...c }));
    Object.freeze(frozen);
    sma(frozen, 5);
    ema(frozen, 5);
    bollinger(frozen, 5, 2);
    rsi(frozen, 5);
    macd(frozen, 3, 6, 4);
    expect(frozen).toEqual(input);
  });

  it("handle 20,000 candles quickly without drifting", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let price = 30000;
    const closes = Array.from({ length: 20000 }, () => (price *= 1 + (random() - 0.5) * 0.04));
    const input = candles(closes);
    const period = 200;

    const started = performance.now();
    const smaResult = sma(input, period);
    const bands = bollinger(input, period, 2);
    ema(input, period);
    rsi(input, period);
    macd(input, period, 2 * period, period);
    expect(performance.now() - started).toBeLessThan(1000);

    // Last window recomputed directly.
    const window = closes.slice(-period);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    expect(smaResult).toHaveLength(20000 - period + 1);
    expect(smaResult.at(-1)!.value).toBeCloseTo(mean, 6);
    expect(bands.at(-1)!.middle).toBeCloseTo(mean, 6);
    expect(bands.at(-1)!.upper).toBeCloseTo(mean + 2 * sd, 6);
    expect(bands.at(-1)!.lower).toBeCloseTo(mean - 2 * sd, 6);
  });
});
