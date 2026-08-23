// Deterministic technical indicators for the wheel bot. Pure functions, no Deno
// or network deps, so the engine that uses them is unit-testable under Node too.

export interface Candle {
  datetime: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

// Simple moving average of the last `period` values (null if not enough data).
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// Wilder's RSI over `period` (default 14). Null if not enough data.
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Average True Range over `period` (default 14). Null if not enough data.
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return trs.reduce((s, v) => s + v, 0) / trs.length;
}

// Percent return over the last `lookback` bars: last/close[lookback ago] - 1.
export function pctReturn(values: number[], lookback: number): number | null {
  if (values.length < lookback + 1) return null;
  const prior = values[values.length - 1 - lookback];
  if (!prior) return null;
  return values[values.length - 1] / prior - 1;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// MACD (12/26) with 9-period signal. Returns the latest {macd, signal, hist}.
export function macd(values: number[]): { macd: number; signal: number; hist: number } | null {
  if (values.length < 35) return null;
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = ema(macdLine.slice(26), 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: signalVal, hist: macdVal - signalVal };
}

// Lowest low over the last `lookback` bars — a crude recent-support proxy.
export function recentSwingLow(candles: Candle[], lookback = 20): number | null {
  if (!candles.length) return null;
  const slice = candles.slice(-lookback);
  return Math.min(...slice.map((c) => c.low));
}

export function fiftyTwoWeekLow(candles: Candle[]): number | null {
  if (!candles.length) return null;
  return Math.min(...candles.slice(-252).map((c) => c.low));
}

// ── Murphy-style structure/participation indicators ──────────────────────────

// Slope of an SMA over the last `lookback` bars, as a fraction (rising > 0).
// Approximates higher-timeframe trend direction from daily data.
export function smaSlope(values: number[], period: number, lookback = 10): number | null {
  if (values.length < period + lookback) return null;
  const now = sma(values, period);
  const past = sma(values.slice(0, values.length - lookback), period);
  if (now == null || past == null || past === 0) return null;
  return (now - past) / past;
}

// Wilder RSI at every index (NaN until enough history) — needed for divergence.
export function rsiSeries(values: number[], period = 14): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// On-Balance Volume: last value and whether it's rising (participation confirms
// the move). rising = OBV now above OBV `lookback` bars ago.
export function obv(candles: Candle[], lookback = 10): { value: number; rising: boolean } | null {
  if (candles.length < lookback + 2) return null;
  const series: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = series[i - 1];
    if (candles[i].close > candles[i - 1].close) series.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) series.push(prev - candles[i].volume);
    else series.push(prev);
  }
  const value = series[series.length - 1];
  return { value, rising: value > series[series.length - 1 - lookback] };
}

export interface Pivot {
  i: number;
  price: number;
}

// Swing pivots: a high is a strict local max over ±w bars, a low a strict min.
export function swings(candles: Candle[], w = 3): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].high });
    if (isLow) lows.push({ i, price: candles[i].low });
  }
  return { highs, lows };
}

// Swing structure over recent pivots: higher-highs & higher-lows (uptrend),
// lower-highs & lower-lows (downtrend), or mixed.
export function trendStructure(candles: Candle[]): { higherHighs: boolean; higherLows: boolean; label: "uptrend" | "downtrend" | "mixed" } {
  const { highs, lows } = swings(candles, 3);
  const hh = highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows.length >= 2 && lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lh = highs.length >= 2 && highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price;
  const label = hh && hl ? "uptrend" : lh && ll ? "downtrend" : "mixed";
  return { higherHighs: hh, higherLows: hl, label };
}

// Price/RSI divergence over the last two swing pivots within `lookback` bars.
// Bearish: higher price high, lower RSI high. Bullish: lower price low, higher RSI low.
export function divergence(candles: Candle[], rsiSer: number[], lookback = 45): { bearish: boolean; bullish: boolean } {
  const cutoff = candles.length - lookback;
  const { highs, lows } = swings(candles, 3);
  const recentHighs = highs.filter((p) => p.i >= cutoff && !Number.isNaN(rsiSer[p.i]));
  const recentLows = lows.filter((p) => p.i >= cutoff && !Number.isNaN(rsiSer[p.i]));
  let bearish = false;
  let bullish = false;
  if (recentHighs.length >= 2) {
    const [a, b] = recentHighs.slice(-2);
    bearish = b.price > a.price && rsiSer[b.i] < rsiSer[a.i];
  }
  if (recentLows.length >= 2) {
    const [a, b] = recentLows.slice(-2);
    bullish = b.price < a.price && rsiSer[b.i] > rsiSer[a.i];
  }
  return { bearish, bullish };
}

// How well a price level is backed by recent swing lows (support quality): count
// of swing lows within `tolPct` of the level over the last `lookback` bars.
export function supportTouches(candles: Candle[], level: number, tolPct = 0.02, lookback = 120): number {
  if (level <= 0) return 0;
  const cutoff = candles.length - lookback;
  const { lows } = swings(candles, 3);
  return lows.filter((p) => p.i >= cutoff && Math.abs(p.price - level) / level <= tolPct).length;
}
