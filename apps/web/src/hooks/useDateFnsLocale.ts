'use client';

import { useLocale } from 'next-intl';
import type { Locale as DateFnsLocale } from 'date-fns/locale';
// react-day-picker's locales are date-fns's own, extended with the calendar's screen
// reader labels ("Zum nächsten Monat", "Heute, …") in that language.
import { enUS, uk, ru, zhCN, ar, fr, ptBR, id, es, de } from 'react-day-picker/locale';

// The date-fns locale matching the interface language, for the components that
// format dates themselves instead of going through next-intl (the calendar's
// month and weekday names and its accessible labels).
const LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  uk,
  ru,
  'zh-CN': zhCN,
  ar,
  fr,
  'pt-BR': ptBR,
  id,
  'es-ES': es,
  de,
};

export function useDateFnsLocale(): DateFnsLocale {
  return LOCALES[useLocale()] ?? enUS;
}
