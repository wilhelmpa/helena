import { TZDate } from '@date-fns/tz';
import { addDays as addCalendarDays, differenceInCalendarDays } from 'date-fns';
import type { StateType } from '@/lib/api/endpoints/columns';
import { DEFAULT_LOCALE } from '@/i18n/locales';

// Date helpers shared by the project views. Kept separate from project grouping so
// components that only need date math (Calendar, Timeline, cards) do not pull in
// the sorting/grouping code.

// The language dates are rendered in. A module variable for the same reason as the
// timezone below; PreferencesSync sets it in the browser while rendering, before the
// tree that formats dates. A server render keeps the default, so the value never
// crosses between requests.
let displayLocale: string = DEFAULT_LOCALE;

export function setDisplayLocale(locale: string): void {
  displayLocale = locale;
}

export function getDisplayLocale(): string {
  return displayLocale;
}

// The zone timestamps are rendered in: the zone next-intl renders the page in (the
// account's, through the timezone cookie; see i18n/request.ts), so these formatters and
// next-intl's always agree. The API stores and returns UTC; only the display side
// applies a zone. Held in a module variable so the formatters stay plain functions
// callable outside React; PreferencesSync sets it in the browser while rendering.
// Empty means "use the browser zone".
let displayTimezone = '';

export function setDisplayTimezone(timezone: string): void {
  displayTimezone = timezone;
}

// Zones IANA renamed but whose old name most runtimes still report. Both names
// resolve to the same zone, so the app offers, detects and stores the current one.
const RENAMED_ZONES: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Godthab': 'America/Nuuk',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

// The current IANA name for a zone, given a possibly outdated one.
export function canonicalTimezone(zone: string): string {
  return RENAMED_ZONES[zone] ?? zone;
}

// Whether Intl knows the zone.
export function isTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A moment as a date whose getters read the display zone (TZDate from @date-fns/tz), or
// the browser's when no zone is set.
function inDisplayZone(date: Date): Date {
  return displayTimezone ? new TZDate(date, displayTimezone) : date;
}

// The timezone option for Intl. Omitted while no preference is known, so Intl uses
// the browser zone.
function zoneOption(): { timeZone?: string } {
  return displayTimezone ? { timeZone: displayTimezone } : {};
}

// "Jul 2" from an ISO datetime or a "YYYY-MM-DD" date; the raw string if it
// does not parse (kept so a card never renders "Invalid Date"). A date-only value
// is a calendar date, not a moment, so it is never shifted into another zone.
export function formatShortDate(value: string): string {
  const dateOnly = value.length <= 10;
  const date = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(displayLocale, {
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? {} : zoneOption()),
  });
}

// "Jul 2, 2026" for a moment in time (an ISO datetime from the API), rendered in
// the user's zone. Date-only values ("YYYY-MM-DD") pass through unshifted.
export function formatDate(value: string): string {
  const dateOnly = value.length <= 10;
  const date = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(displayLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(dateOnly ? {} : zoneOption()),
  });
}

// The year a moment falls in, in the display zone. A fixed locale: the value is
// compared, never shown.
function zonedYear(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', ...zoneOption() });
}

// "Jul 2, 14:05" for a moment in time, rendered in the user's zone. A moment from
// another year carries it — "Jul 2, 2025, 14:05" — so an old row is not read as a
// recent one.
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const thisYear = zonedYear(date) === zonedYear(new Date());
  return date.toLocaleString(displayLocale, {
    month: 'short',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...zoneOption(),
  });
}

// The "YYYY-MM-DD" day and "HH:mm" time a moment falls on in the user's zone —
// the parts a date-time picker edits. Null for an unparseable value.
export function toZonedParts(value: string): { day: string; time: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const zoned = inDisplayZone(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: toDateStr(zoned), time: `${pad(zoned.getHours())}:${pad(zoned.getMinutes())}` };
}

// The moment a day + time in the user's zone stands for, as an ISO string. A time that a
// DST switch skips lands on the offset in force after it.
export function fromZonedParts(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const moment = displayTimezone
    ? new TZDate(year, month - 1, date, hours, minutes, displayTimezone)
    : new Date(year, month - 1, date, hours, minutes);
  return new Date(moment.getTime()).toISOString();
}

// "Jul 2, 14:05 – 16:30" for a range, rendered in the user's zone; the day is
// repeated on the end when it falls on another one. Without an end it is a
// single moment.
export function formatDateTimeRange(start: string, end: string | null): string {
  if (!end) return formatDateTime(start);
  if (dayKey(start) !== dayKey(end)) return `${formatDateTime(start)} – ${formatDateTime(end)}`;
  return `${formatDateTime(start)} – ${toZonedParts(end)?.time ?? end}`;
}

// "July 2, 2026" for a moment in time, rendered in the user's zone.
export function formatLongDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(displayLocale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...zoneOption(),
  });
}

// "2:05 PM" for a moment in time, rendered in the user's zone.
export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(displayLocale, {
    hour: 'numeric',
    minute: '2-digit',
    ...zoneOption(),
  });
}

// "July 2026" for a calendar date the caller already built in local time (the
// timeline's month band), so no zone is applied.
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(displayLocale, { month: 'long', year: 'numeric' });
}

// The calendar day a moment falls on in the user's zone, as "YYYY-MM-DD". Used to
// group a list by day, so the grouping matches the dates rendered next to it.
export function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-CA', zoneOption());
}

// Parses a "YYYY-MM-DD" date string at local midnight, so day math in the
// calendar and timeline never shifts across a timezone boundary. Returns null
// for a null/empty/unparseable value.
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

// True when a due date ("YYYY-MM-DD") is before today (local) — i.e. overdue. A
// date of today is not overdue; a null/unparseable value is never overdue.
export function isOverdue(value: string | null): boolean {
  const date = parseDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// Like isOverdue, but a closed issue (completed or canceled state) is never
// overdue: its due date passing no longer matters.
export function isDueOverdue(value: string | null, stateType?: StateType): boolean {
  if (stateType === 'completed' || stateType === 'canceled') return false;
  return isOverdue(value);
}

// A local Date back to "YYYY-MM-DD" (the wire format the API stores dates in).
export function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole days between two local dates (b - a), ignoring the time of day.
export function daysBetween(a: Date, b: Date): number {
  return differenceInCalendarDays(b, a);
}

// A compact duration in the display language, e.g. "5m", "3h", "11d" in English and
// "5 Min.", "3 Std.", "11 T" in German (Intl.DurationFormat, narrow). Largest whole unit
// among minutes/hours/days; under a minute reads as zero minutes.
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  if (minutes < 60) {
    // "always": a zero duration would otherwise format as an empty string.
    return new Intl.DurationFormat(displayLocale, {
      style: 'narrow',
      minutesDisplay: 'always',
    }).format({ minutes });
  }
  const duration = hours < 24 ? { hours } : { days: Math.floor(hours / 24) };
  return new Intl.DurationFormat(displayLocale, { style: 'narrow' }).format(duration);
}

// The same compact duration, counted from an ISO datetime to now. Empty string for an
// unparseable value.
export function formatDurationShort(fromIso: string): string {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return '';
  return formatDuration(Date.now() - from);
}

// A new local date `n` days after `date` (n may be negative).
export function addDays(date: Date, n: number): Date {
  return addCalendarDays(date, n);
}
