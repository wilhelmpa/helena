import { describe, expect, it } from 'bun:test';
import type { AlpacaBar } from '../alpaca/client';
import { atr, bollinger, ema, highLow, macd, rsi, sma, vwap } from './index';

const bar = (
  day: number,
  close: number,
  high = close + 1,
  low = close - 1,
  volume = 10,
): AlpacaBar => ({
  t: new Date(Date.UTC(2026, 0, day)).toISOString(),
  o: close,
  h: high,
  l: low,
  c: close,
  v: volume,
});

describe('published indicator conventions', () => {
  it('reproduces the classic 14-period Wilder RSI example within displayed rounding', () => {
    // StockCharts/Wilder example closes; the published first RSI is about 70.5.
    // https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28,
    ];
    expect(rsi(closes)[13]).toBeNull();
    expect(rsi(closes)[14]).toBeCloseTo(70.46, 1);
  });

  it('uses the StockCharts ATR14 smoothing checkpoints', () => {
    // Published checkpoint: first ATR 3.6646; day 15 TR 4.3437 -> ATR 3.7131.
    // https://vb.fx-arabia.com/uploaded/178_01280868405.pdf (ChartSchool, pp. 10-11)
    const bars = Array.from({ length: 14 }, (_, i) => bar(i + 1, 100, 101.8323, 98.1677));
    bars.push(bar(15, 100, 102.17185, 97.82815));
    expect(atr(bars)[13]).toBeCloseTo(3.6646, 4);
    expect(atr(bars)[14]).toBeCloseTo(3.7131, 4);
  });

  it('uses 20-period SMA and two population standard deviations for Bollinger bands', () => {
    // https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/bollinger-bands
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    const bands = bollinger(closes);
    expect(bands.middle[19]).toBe(10.5);
    expect(bands.upper[19]).toBeCloseTo(10.5 + 2 * Math.sqrt(33.25), 10);
    expect(bands.lower[19]).toBeCloseTo(10.5 - 2 * Math.sqrt(33.25), 10);
  });

  it('seeds EMA with SMA, delays MACD signal nine values, and resets VWAP by session', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(sma(ramp, 3)[2]).toBe(2);
    expect(ema(ramp, 3)[2]).toBe(2);
    expect(ema(ramp, 3)[39]).toBe(39);
    const m = macd(ramp);
    expect(m.line[25]).toBeCloseTo(7, 10);
    expect(m.signal[32]).toBeNull();
    expect(m.signal[33]).toBeCloseTo(7, 10);
    const bars = [
      { ...bar(1, 10, 12, 8, 2), t: '2026-01-01T10:00:00Z' },
      { ...bar(1, 20, 22, 18, 3), t: '2026-01-01T11:00:00Z' },
      { ...bar(2, 30, 32, 28, 4), t: '2026-01-02T10:00:00Z' },
    ];
    expect(vwap(bars)).toEqual([10, 16, 30]);
    expect(highLow(bars, 2).high).toEqual([null, 22, 32]);
    expect(highLow(bars, 2).low).toEqual([null, 8, 18]);
  });
});
