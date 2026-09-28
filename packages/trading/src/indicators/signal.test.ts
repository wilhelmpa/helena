import { describe, expect, it } from 'bun:test';
import type { ToolCallContext } from '@helena/sdk';
import type { AlpacaBar, Fetch } from '../alpaca/client';
import { alpacaPaperTools } from '../alpaca/tools';
import { checkSignal, STRATEGY } from './signal';

const bars: AlpacaBar[] = Array.from({ length: 56 }, (_, i) => {
  const close = 100 + i * 0.15 + 3 * Math.sin(i * 0.35);
  return {
    t: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    o: close,
    h: close + 1,
    l: close - 1,
    c: close,
    v: 1000,
  };
});

describe('macd-rsi-atr v1', () => {
  it('requires a fresh cross and calculates the full paper risk plan', () => {
    const previous = checkSignal(bars.slice(0, -1), 100_000);
    expect(previous.signal).toBe(false);
    const result = checkSignal(bars, 100_000);
    expect(result.signal).toBe(true);
    expect(result.previousMacd).toBeLessThanOrEqual(result.previousSignalLine);
    expect(result.macd).toBeGreaterThan(result.signalLine);
    expect(result.rsi).toBeLessThan(70);
    expect(result.entry).toBeGreaterThan(result.ema50);
    expect(result.riskUsd).toBe(500);
    expect(result.stop).toBeCloseTo(result.entry - 1.5 * result.atr, 10);
    expect(result.target).toBeCloseTo(result.entry + 3 * result.atr, 10);
    expect(result.quantity).toBe(163.354234);
    expect(result.plannedRiskUsd).toBeLessThanOrEqual(500);
    expect(checkSignal(bars, 100_000, 1).quantity).toBe(326.708469);
  });

  it('rejects missing history, zero equity and invalid candles', () => {
    expect(() => checkSignal(bars.slice(0, 49), 100_000)).toThrow('50');
    expect(() => checkSignal(bars, 0)).toThrow('equity');
    expect(() => checkSignal([{ ...bars[0]!, h: 0 }, ...bars.slice(1)], 100_000)).toThrow('OHLCV');
  });

  it('explains independent RSI, trend and ATR vetoes', () => {
    const surge = bars.slice(0, -1).concat({ ...bars.at(-1)!, o: 140, h: 141, l: 139, c: 140 });
    expect(checkSignal(surge, 100_000).reasons).toContain('RSI mindestens 70.');
    const fall = bars.slice(0, -1).concat({ ...bars.at(-1)!, o: 90, h: 91, l: 89, c: 90 });
    expect(checkSignal(fall, 100_000).reasons).toContain('Schlusskurs nicht über EMA(50).');
    const flat = bars.map((bar) => ({ ...bar, o: 100, h: 100, l: 100, c: 100 }));
    const noVolatility = checkSignal(flat, 100_000);
    expect(noVolatility.signal).toBe(false);
    expect(noVolatility.stop).toBeNull();
    expect(noVolatility.reasons).toContain('ATR null oder Stopp nicht positiv.');
  });

  it('serves both read tools through the paper connector using fixtures only', async () => {
    const requests: { host: string; method: string }[] = [];
    const fetchImpl: Fetch = async (input, init) => {
      const url = new URL(input);
      requests.push({ host: url.host, method: init?.method ?? 'GET' });
      const body =
        url.pathname === '/v2/account'
          ? {
              id: '11111111-2222-4333-8444-555555555555',
              status: 'ACTIVE',
              currency: 'USD',
              equity: '100000',
              last_equity: '100000',
              cash: '100000',
              buying_power: '100000',
              trading_blocked: false,
              account_blocked: false,
            }
          : { bars: { SPY: bars } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const ctx = {
      agent: null,
      project: { id: 1, key: 'TRADE', teamId: 1 },
      credentialId: 1,
      credential: { keyId: 'PKTEST1234567890', secretKey: 'fixture' },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    } as ToolCallContext;
    const tools = alpacaPaperTools({
      fetch: fetchImpl,
      now: () => new Date('2026-04-01T00:00:00Z'),
    });
    const indicators = tools.find((tool) => tool.name === 'trading_indikatoren')!;
    const signal = tools.find((tool) => tool.name === 'trading_signal_pruefen')!;
    expect(indicators.connector).toBe('alpaca_paper');
    expect(signal.connector).toBe('alpaca_paper');
    expect(indicators.category).toBe('read');
    expect(signal.category).toBe('read');
    const values = (await indicators.handler(
      { symbol: 'SPY', timeframe: '1Day', lookback: 200 },
      ctx,
    )) as { indicators: { rsi14: { latest: number; history: unknown[] } }; source: string };
    expect(values.indicators.rsi14.latest).toBeCloseTo(checkSignal(bars, 100_000).rsi, 10);
    expect(values.indicators.rsi14.history).toHaveLength(5);
    expect(values.source).toContain('IEX');
    expect((values as unknown as { lastBar: { close: number } }).lastBar.close).toBe(
      bars.at(-1)!.c,
    );
    const result = (await signal.handler(
      { strategie: STRATEGY, symbol: 'SPY', riskPercent: 0.5 },
      ctx,
    )) as { signal: boolean; orderPlaced: boolean; quantity: number };
    expect(result.signal).toBe(true);
    expect(result.orderPlaced).toBe(false);
    expect(result.quantity).toBe(163.354234);
    expect(
      requests.every(
        ({ host, method }) =>
          method === 'GET' && ['data.alpaca.markets', 'paper-api.alpaca.markets'].includes(host),
      ),
    ).toBe(true);
  });
});
