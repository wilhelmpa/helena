export type TradingPeriod = 'today' | 'week' | 'pilot';

export function periodStart(period: TradingPeriod, now = new Date()): Date | null {
  if (period === 'pilot') return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  const local = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  if (period === 'week') {
    const days = (local.getUTCDay() + 6) % 7;
    local.setUTCDate(local.getUTCDate() - days);
  }
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(local)
    .find((part) => part.type === 'timeZoneName')?.value;
  const hours = Number(offset?.match(/GMT([+-]\d+)/)?.[1] ?? 1);
  return new Date(local.getTime() - hours * 3_600_000);
}

export function rsiFromIndicators(value: string): number | null {
  const found = value.match(/\bRSI(?:\s*\([^)]*\))?\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i);
  if (!found) return null;
  const rsi = Number(found[1].replace(',', '.'));
  return rsi >= 0 && rsi <= 100 ? rsi : null;
}

export function hypotheticalPercent(value: string | null): number | null {
  if (!value) return null;
  const found = value.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  return found ? Number(found[1].replace(',', '.')) : null;
}
