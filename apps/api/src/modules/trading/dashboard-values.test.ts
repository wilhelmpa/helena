import { describe, expect, it } from 'bun:test';
import { hypotheticalPercent, periodStart, rsiFromIndicators } from './dashboard-values';

describe('trading dashboard values', () => {
  it('uses Berlin calendar boundaries for today and week', () => {
    const now = new Date('2026-09-28T05:00:00Z');
    expect(periodStart('today', now)?.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(periodStart('week', now)?.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(periodStart('pilot', now)).toBeNull();
  });

  it('reads only valid indicator and journal values from cards', () => {
    expect(rsiFromIndicators('RSI 57 · MACD ↗')).toBe(57);
    expect(rsiFromIndicators('RSI(14): 65,5')).toBe(65.5);
    expect(rsiFromIndicators('RSI 101')).toBeNull();
    expect(hypotheticalPercent('+0,4 %')).toBe(0.4);
    expect(hypotheticalPercent(null)).toBeNull();
  });
});
