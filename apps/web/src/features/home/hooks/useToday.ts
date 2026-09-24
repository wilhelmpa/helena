import { useSyncExternalStore } from 'react';
import { formatLongDate } from '@/utils/dates';

const subscribe = () => () => {};

// Today's date, written out ("24. September 2026"), or null on the server and in the
// first client render. The server renders in its own zone and locale, so a date it
// wrote would not match the reader's after midnight or in another language — React
// then throws the page away and renders it again (a hydration error). The date appears
// right after hydration instead.
export function useToday(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => formatLongDate(new Date().toISOString()),
    () => null,
  );
}
