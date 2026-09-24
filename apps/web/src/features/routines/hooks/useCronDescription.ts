import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { describeCronIn, type CronWords } from '../utils/cronDescribe';

// A cron expression described in the reader's language ("Um 09:00 · Montag bis
// Freitag"): the phrases from the routines messages, times, weekday and month names
// and lists from the browser's Intl for the locale.
export function useCronDescription(): (cron: string) => string | null {
  const t = useTranslations('routines.cron');
  const locale = useLocale();
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    const month = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    const list = new Intl.ListFormat(locale, { type: 'conjunction' });
    const words: CronWords = {
      everyMinute: t('everyMinute'),
      everyNMinutes: (n) => t('everyNMinutes', { n }),
      everyHour: t('everyHour'),
      everyNHours: (n) => t('everyNHours', { n }),
      everyNHoursAtMinute: (n, minute) => t('everyNHoursAtMinute', { n, minute }),
      at: (times) => t('at', { times }),
      everyNMinutesBetween: (n, start, end) => t('everyNMinutesBetween', { n, start, end }),
      everyHourBetween: (start, end) => t('everyHourBetween', { start, end }),
      everyNHoursBetween: (n, start, end) => t('everyNHoursBetween', { n, start, end }),
      atMinuteDuringHour: (minute, hour) => t('atMinuteDuringHour', { minute, hour }),
      onDays: (days) => t('onDays', { days }),
      onDaysOrWeekdays: (days, weekdays) => t('onDaysOrWeekdays', { days, weekdays }),
      inMonths: (months) => t('inMonths', { months }),
      weekdays: t('weekdays'),
      weekends: t('weekends'),
      through: (start, end) => t('through', { start, end }),
      dayOrdinal: (n) => t('dayOrdinal', { n }),
      time: (hour, minute) => time.format(Date.UTC(2023, 0, 1, hour, minute)),
      // 2023-01-01 was a Sunday, so day 0 is Sunday like cron's.
      weekdayName: (day) => weekday.format(Date.UTC(2023, 0, 1 + day)),
      monthName: (value) => month.format(Date.UTC(2023, value - 1, 1)),
      list: (items) => list.format(items),
    };
    return (cron: string) => describeCronIn(cron, words);
  }, [locale, t]);
}
