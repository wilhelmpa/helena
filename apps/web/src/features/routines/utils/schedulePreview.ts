import { Cron } from 'croner';
import { getDisplayLocale } from '@/utils/dates';

// The time zone of a schedule that names none. The API falls back to the same one.
export const DEFAULT_TIMEZONE = 'Europe/Berlin';

export function isTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The next times the cron fires in the time zone; none for a cron or zone that does
// not parse.
export function nextRuns(cron: string, timezone: string, count = 3, from = new Date()): Date[] {
  if (!isTimeZone(timezone)) return [];
  try {
    return new Cron(cron, { timezone, paused: true }).nextRuns(count, from);
  } catch {
    return [];
  }
}

// A time as a clock in the schedule's zone shows it.
export function formatInZone(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat(getDisplayLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
}
