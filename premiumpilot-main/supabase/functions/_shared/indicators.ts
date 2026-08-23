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
