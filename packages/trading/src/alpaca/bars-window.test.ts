import { describe, expect, it } from 'bun:test';
import { lookbackStart } from './tools';

const monday = new Date('2026-09-28T13:22:00Z'); // 15:22 in Berlin, before the US open

describe('bars window', () => {
  it('reaches back far enough for intraday stock bars across a weekend', () => {
    const start = lookbackStart('SPY', '15Min', 100, monday);
    // 100 fifteen-minute bars are about four sessions: the window must start before the
    // previous Tuesday's session.
    expect(start.getTime()).toBeLessThan(new Date('2026-09-22T13:30:00Z').getTime());
  });

  it('keeps daily windows long enough for 200 sessions', () => {
    const start = lookbackStart('AAPL', '1Day', 200, monday);
    const days = (monday.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(200 * 1.4);
  });

  it('uses clock time for crypto, which trades around the clock', () => {
    const start = lookbackStart('BTC/USD', '1Hour', 100, monday);
    const hours = (monday.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(100);
    expect(hours).toBeLessThan(200);
  });
});
