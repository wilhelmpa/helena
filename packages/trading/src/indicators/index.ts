import type { AlpacaBar } from '../alpaca/client';

export type Series = (number | null)[];

export function validateBars(bars: readonly AlpacaBar[]): void {
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (
      !Number.isFinite(Date.parse(bar.t)) ||
      (i > 0 && bar.t <= bars[i - 1]!.t) ||
      ![bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) ||
      bar.l <= 0 ||
      bar.h < bar.l ||
      bar.o < bar.l ||
      bar.o > bar.h ||
      bar.c < bar.l ||
      bar.c > bar.h ||
      bar.v < 0
    )
      throw new Error('Bars must be chronological, valid OHLCV values.');
  }
}

function periodOf(period: number): void {
  if (!Number.isInteger(period) || period < 1)
    throw new Error('Period must be a positive integer.');
}

export function sma(values: readonly number[], period: number): Series {
  periodOf(period);
  const result: Series = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

// Seed with the first SMA, then use the standard 2/(period+1) multiplier.
export function ema(values: readonly number[], period: number): Series {
  periodOf(period);
  const result: Series = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous = alpha * values[i]! + (1 - alpha) * previous;
    result[i] = previous;
  }
  return result;
}

export function macd(values: readonly number[]) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line: Series = slow.map((value, i) => (value === null ? null : fast[i]! - value));
  const signalTail = ema(
    line.slice(25).filter((value): value is number => value !== null),
    9,
  );
  const signal: Series = Array(values.length).fill(null);
  signalTail.forEach((value, i) => {
    signal[i + 25] = value;
  });
  const histogram = line.map((value, i) =>
    value === null || signal[i] === null ? null : value - signal[i]!,
  );
  return { line, signal, histogram };
}

export function rsi(values: readonly number[], period = 14): Series {
  periodOf(period);
  const result: Series = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  result[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = value();
  }
  return result;
}

export function atr(bars: readonly AlpacaBar[], period = 14): Series {
  periodOf(period);
  const result: Series = Array(bars.length).fill(null);
  if (bars.length < period) return result;
  const ranges = bars.map((bar, i) =>
    i === 0
      ? bar.h - bar.l
      : Math.max(bar.h - bar.l, Math.abs(bar.h - bars[i - 1]!.c), Math.abs(bar.l - bars[i - 1]!.c)),
  );
  let previous = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  for (let i = period; i < bars.length; i++) {
    previous = (previous * (period - 1) + ranges[i]!) / period;
    result[i] = previous;
  }
  return result;
}

export function bollinger(values: readonly number[], period = 20, deviations = 2) {
  periodOf(period);
  const middle = sma(values, period);
  const upper: Series = Array(values.length).fill(null);
  const lower: Series = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j]! - mean) ** 2;
    const spread = deviations * Math.sqrt(variance / period);
    upper[i] = mean + spread;
    lower[i] = mean - spread;
  }
  return { middle, upper, lower };
}

// Typical-price VWAP, restarting at each UTC calendar day (one session for this pilot).
export function vwap(bars: readonly AlpacaBar[]): Series {
  let session = '';
  let volume = 0;
  let weighted = 0;
  return bars.map((bar) => {
    const day = bar.t.slice(0, 10);
    if (day !== session) {
      session = day;
      volume = 0;
      weighted = 0;
    }
    volume += bar.v;
    weighted += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    return volume > 0 ? weighted / volume : null;
  });
}

export function highLow(bars: readonly AlpacaBar[], period = 20) {
  periodOf(period);
  const high: Series = Array(bars.length).fill(null);
  const low: Series = Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const window = bars.slice(i - period + 1, i + 1);
    high[i] = Math.max(...window.map((bar) => bar.h));
    low[i] = Math.min(...window.map((bar) => bar.l));
  }
  return { high, low };
}

export function indicatorSet(bars: readonly AlpacaBar[]) {
  validateBars(bars);
  const close = bars.map((bar) => bar.c);
  return {
    sma20: sma(close, 20),
    ema12: ema(close, 12),
    ema26: ema(close, 26),
    ema50: ema(close, 50),
    macd: macd(close),
    rsi14: rsi(close),
    atr14: atr(bars),
    bollinger20: bollinger(close),
    vwap: vwap(bars),
    highLow20: highLow(bars),
  };
}
