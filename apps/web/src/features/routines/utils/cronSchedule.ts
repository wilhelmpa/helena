import { Cron } from 'croner';
import { formatCron, parseCron } from './cronFields';
import { parseCronText } from './cronTextParser';

export type ScheduleInputResult =
  { ok: true; source: 'cron' | 'text'; cron: string } | { ok: false; error: string };

// Whether croner, the library the API computes schedules with, accepts the expression:
// the form takes exactly what the server does.
function croner(expression: string): boolean {
  try {
    new Cron(expression, { paused: true });
    return true;
  } catch {
    return false;
  }
}

// A cron expression, or a schedule in words (English or German), as the cron the routine
// stores. A cron the field parser can read is normalized (names become numbers); one it
// cannot, which croner still accepts (L, #), is kept as typed.
export function parseScheduleInput(input: string): ScheduleInputResult {
  const value = input.trim();
  if (!value) return { ok: false, error: 'Enter a schedule.' };

  if (looksLikeCron(value)) {
    const parsed = parseCron(value);
    const cron = parsed.ok ? formatCron(parsed.value) : value;
    if (!croner(cron))
      return parsed.ok ? { ok: false, error: 'Check the cron expression.' } : parsed;
    return { ok: true, source: 'cron', cron };
  }

  const parsed = parseCronText(value);
  if (!parsed.ok) return parsed;
  if (!croner(parsed.value)) return { ok: false, error: 'Check the schedule.' };
  return { ok: true, source: 'text', cron: parsed.value };
}

function looksLikeCron(value: string): boolean {
  const parts = value.split(/\s+/);
  return parts.length === 5 && /^[\d*/,-]+$/.test(parts[0]);
}
