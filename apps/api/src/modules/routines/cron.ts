import { Cron } from 'croner';
import { HttpError } from '#shared/lib';

function parseCron(expression: string, timezone: string): Cron {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new HttpError(400, 'Invalid time zone');
  }
  try {
    return new Cron(expression, { timezone, paused: true });
  } catch {
    throw new HttpError(400, 'Invalid cron expression');
  }
}

// The shortest gap between the runs ahead. A cron fires irregularly ('0 0 * * 1,2'),
// so measuring only the gap after the first run would let a burst through.
export function minCronIntervalSeconds(
  expression: string,
  timezone: string,
  from = new Date(),
): number {
  const runs = parseCron(expression, timezone).nextRuns(5, from);
  if (runs.length < 2) throw new HttpError(400, 'Invalid cron expression');
  let shortest = Infinity;
  for (let i = 1; i < runs.length; i++) {
    shortest = Math.min(shortest, (runs[i].getTime() - runs[i - 1].getTime()) / 1000);
  }
  return shortest;
}
