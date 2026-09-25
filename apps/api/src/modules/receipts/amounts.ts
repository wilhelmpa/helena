import { parseAmountCents } from '@helena/finance';

// The tables keep money as numeric(14,2), which Postgres hands back as a decimal string;
// @helena/finance and the API speak integer cents. These two convert without floats.

export function centsToNumeric(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function numericToCents(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : parseAmountCents(value, 'en');
}

// 'YYYY-MM' to its first day and the first day of the next month.
export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}
