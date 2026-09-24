import { parseCron, type CronFields } from './cronFields';

// The words a cron description is built from, in the reader's language. The clauses
// are joined with " · " ("Um 09:00 · Montag bis Freitag"), which reads the same in
// every language, so no grammar across clauses is needed.
export interface CronWords {
  everyMinute: string;
  everyNMinutes: (n: number) => string;
  everyHour: string;
  everyNHours: (n: number) => string;
  everyNHoursAtMinute: (n: number, minute: number) => string;
  at: (times: string) => string;
  everyNMinutesBetween: (n: number, start: string, end: string) => string;
  everyHourBetween: (start: string, end: string) => string;
  everyNHoursBetween: (n: number, start: string, end: string) => string;
  atMinuteDuringHour: (minute: string, hour: string) => string;
  onDays: (days: string) => string;
  onDaysOrWeekdays: (days: string, weekdays: string) => string;
  inMonths: (months: string) => string;
  weekdays: string;
  weekends: string;
  through: (start: string, end: string) => string;
  dayOrdinal: (n: number) => string;
  time: (hour: number, minute: number) => string;
  weekdayName: (day: number) => string;
  monthName: (month: number) => string;
  list: (items: string[]) => string;
}

// "Um 09:00 · Montag bis Freitag" for "0 9 * * 1-5"; null for an expression that
// does not parse.
export function describeCronIn(expression: string, words: CronWords): string | null {
  const parsed = parseCron(expression);
  if (!parsed.ok) return null;
  return [describeTime(parsed.value, words), ...describeDate(parsed.value, words)].join(' · ');
}

function describeTime(fields: CronFields, w: CronWords): string {
  const minuteStep = starStep(fields.minute);
  const hourStep = starStep(fields.hour);

  if (fields.minute === '*' && fields.hour === '*') return w.everyMinute;
  if (minuteStep && fields.hour === '*') return w.everyNMinutes(minuteStep);
  if (fields.minute === '0' && fields.hour === '*') return w.everyHour;
  if (fields.minute === '0' && hourStep) return w.everyNHours(hourStep);
  if (/^\d+$/.test(fields.minute) && hourStep) {
    return w.everyNHoursAtMinute(hourStep, Number(fields.minute));
  }

  const minutes = numericList(fields.minute);
  const hours = numericList(fields.hour);
  if (minutes?.length === 1 && hours) {
    return w.at(w.list(hours.map((hour) => w.time(hour, minutes[0]!))));
  }

  const hourRange = numericRange(fields.hour);
  const steppedHourRange = rangeStep(fields.hour);
  if (minuteStep && hourRange) {
    return w.everyNMinutesBetween(minuteStep, w.time(hourRange[0], 0), w.time(hourRange[1], 0));
  }
  if (minutes?.length === 1 && hourRange) {
    return w.everyHourBetween(w.time(hourRange[0], minutes[0]!), w.time(hourRange[1], minutes[0]!));
  }
  if (minutes?.length === 1 && steppedHourRange) {
    return w.everyNHoursBetween(
      steppedHourRange.step,
      w.time(steppedHourRange.start, minutes[0]!),
      w.time(steppedHourRange.end, minutes[0]!),
    );
  }
  return w.atMinuteDuringHour(fields.minute, fields.hour);
}

function describeDate(fields: CronFields, w: CronWords): string[] {
  const clauses: string[] = [];
  if (fields.dayOfMonth !== '*' && fields.dayOfWeek !== '*') {
    clauses.push(w.onDaysOrWeekdays(ordinals(fields.dayOfMonth, w), weekdays(fields.dayOfWeek, w)));
  } else if (fields.dayOfMonth !== '*') {
    clauses.push(w.onDays(ordinals(fields.dayOfMonth, w)));
  } else if (fields.dayOfWeek !== '*') {
    clauses.push(weekdays(fields.dayOfWeek, w));
  }
  if (fields.month !== '*') clauses.push(w.inMonths(named(fields.month, w.monthName, w)));
  return clauses;
}

function weekdays(field: string, w: CronWords): string {
  if (field === '1-5') return w.weekdays;
  if (field === '0,6' || field === '6,0') return w.weekends;
  return named(field, (day) => w.weekdayName(day === 7 ? 0 : day), w);
}

function named(field: string, name: (value: number) => string, w: CronWords): string {
  const values = numericList(field);
  if (values) return w.list(values.map(name));
  const range = numericRange(field);
  if (range) return w.through(name(range[0]), name(range[1]));
  return field;
}

function ordinals(field: string, w: CronWords): string {
  const values = numericList(field);
  if (values) return w.list(values.map(w.dayOrdinal));
  const range = numericRange(field);
  if (range) return w.through(w.dayOrdinal(range[0]), w.dayOrdinal(range[1]));
  return field;
}

function numericList(field: string): number[] | null {
  if (!/^\d+(?:,\d+)*$/.test(field)) return null;
  return field.split(',').map(Number);
}

function numericRange(field: string): [number, number] | null {
  const match = field.match(/^(\d+)-(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function starStep(field: string): number | null {
  const match = field.match(/^\*\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function rangeStep(field: string): { start: number; end: number; step: number } | null {
  const match = field.match(/^(\d+)-(\d+)\/(\d+)$/);
  return match ? { start: Number(match[1]), end: Number(match[2]), step: Number(match[3]) } : null;
}
