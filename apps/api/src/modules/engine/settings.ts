import { getSetting, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';

// The engine's instance settings (Administrator → Workflows): the time zone routines,
// workflow schedules and wait steps use when they name none. Its default is the server's
// time zone (HELENA_TIMEZONE or TZ), and Europe/Berlin when the server names none.

const KEY = 'engine.timezone';

function isZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function serverTimezone(): string {
  const configured = process.env.HELENA_TIMEZONE?.trim() || process.env.TZ?.trim();
  if (configured && isZone(configured)) return configured;
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolved && resolved !== 'UTC' && isZone(resolved) ? resolved : 'Europe/Berlin';
}

export async function defaultTimezone(): Promise<string> {
  const stored = await getSetting<{ timezone?: unknown }>(KEY);
  return typeof stored?.timezone === 'string' && isZone(stored.timezone)
    ? stored.timezone
    : serverTimezone();
}

export async function engineSettings() {
  const stored = await getSetting<{ timezone?: unknown }>(KEY);
  return {
    defaultTimezone: await defaultTimezone(),
    serverTimezone: serverTimezone(),
    // Whether the default is set here rather than taken from the server.
    timezoneSet: typeof stored?.timezone === 'string',
  };
}

// Sets the default time zone, or with null goes back to the server's.
export async function setDefaultTimezone(timezone: string | null) {
  if (timezone !== null && !isZone(timezone)) throw new HttpError(400, 'Invalid time zone');
  await setSetting(KEY, timezone === null ? {} : { timezone });
  return engineSettings();
}
