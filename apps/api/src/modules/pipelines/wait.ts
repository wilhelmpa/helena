import type { WaitSpec } from './definition';

const TIME_ZONE = 'Europe/Berlin';

// The instant a wall-clock time of a day has in Berlin.
export function berlinTime(day: string, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const guess = new Date(`${day}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(guess);
  const shown =
    Number(parts.find((part) => part.type === 'hour')!.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')!.value);
  let offset = shown - (hours * 60 + minutes);
  if (offset > 720) offset -= 1_440;
  if (offset < -720) offset += 1_440;
  return new Date(guess.getTime() - offset * 60_000);
}

// When a wait step lets its run go on. Null when the task has no date to wait for.
export function wakeTime(
  spec: WaitSpec,
  task: { dueDate: string | null; startDate: string | null } | null,
  now: number,
): Date | null {
  if (spec.kind === 'delay') return new Date(now + spec.minutes * 60_000);
  const day = task?.[spec.field];
  return day ? berlinTime(day, spec.time) : null;
}
