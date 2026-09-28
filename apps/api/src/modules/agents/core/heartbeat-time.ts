export interface HeartbeatClock {
  heartbeatIntervalMinutes: number | null;
  heartbeatTimezone: string;
  heartbeatDays: number[];
  heartbeatStart: string;
  heartbeatEnd: string;
}

const weekdays: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function workFormatter(clock: HeartbeatClock) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: clock.heartbeatTimezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function inWindow(clock: HeartbeatClock, at: Date, formatter: Intl.DateTimeFormat): boolean {
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  return (
    clock.heartbeatDays.includes(weekdays[parts.weekday]!) &&
    time >= clock.heartbeatStart &&
    time < clock.heartbeatEnd
  );
}

export function isHeartbeatWorkTime(clock: HeartbeatClock, at: Date): boolean {
  return inWindow(clock, at, workFormatter(clock));
}

export function validateHeartbeatClock(clock: HeartbeatClock): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clock.heartbeatTimezone });
  } catch {
    throw new Error('Invalid heartbeat time zone');
  }
  if (clock.heartbeatStart >= clock.heartbeatEnd) {
    throw new Error('Heartbeat work hours must end after they start');
  }
  if (
    clock.heartbeatDays.length === 0 ||
    new Set(clock.heartbeatDays).size !== clock.heartbeatDays.length
  ) {
    throw new Error('Heartbeat weekdays must be distinct and nonempty');
  }
}

export function nextHeartbeatAt(clock: HeartbeatClock, after: Date): Date | null {
  if (clock.heartbeatIntervalMinutes == null) return null;
  const formatter = workFormatter(clock);
  const candidate = new Date(after.getTime() + clock.heartbeatIntervalMinutes * 60_000);
  candidate.setUTCSeconds(0, 0);
  for (let i = 0; i < 14 * 24 * 12; i++) {
    if (inWindow(clock, candidate, formatter)) {
      return candidate;
    }
    candidate.setTime(candidate.getTime() + 5 * 60_000);
  }
  throw new Error('No heartbeat work window in the next 14 days');
}
