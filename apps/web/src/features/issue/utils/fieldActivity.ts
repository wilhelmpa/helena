import { formatDate, formatDateTime, formatDateTimeRange } from '@/utils/dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

// A custom field's value as the feed stores it (the API logs the raw value: a UTC
// timestamp, a calendar day, `true`/`false`, a range "start — end"), worded for the
// reader in their language and time zone.
export function readableFieldValue(
  value: string,
  words: { yes: string; no: string },
): string {
  if (value === 'true') return words.yes;
  if (value === 'false') return words.no;
  if (DAY.test(value)) return formatDate(value);
  if (INSTANT.test(value)) return formatDateTime(value);
  const [start, end, ...rest] = value.split(' — ');
  if (rest.length === 0 && start && end && INSTANT.test(start) && INSTANT.test(end)) {
    return formatDateTimeRange(start, end);
  }
  return value;
}
