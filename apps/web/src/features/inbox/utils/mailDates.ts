import { formatShortDate, toZonedParts } from '@/utils/dates';

// The date of a list row: the time for mail of today, the day for anything older.
export function mailListDate(value: string, now = new Date()): string {
  const parts = toZonedParts(value);
  if (!parts) return value;
  return parts.day === toZonedParts(now.toISOString())?.day ? parts.time : formatShortDate(value);
}
