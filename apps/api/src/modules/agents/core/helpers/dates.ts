// Coerces a Date or a date string to an ISO 8601 string. A raw SQL read returns either
// form, so this normalizes both to the string the DTOs use.
export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
