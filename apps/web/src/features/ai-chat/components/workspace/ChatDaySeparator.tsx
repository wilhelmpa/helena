'use client';

import { useTranslations } from 'next-intl';
import { dayKey, formatLongDate } from '@/utils/dates';
import { Marker, MarkerContent } from '@/components/ui/marker';

// The line between two days of a conversation — "Heute", "Gestern", or the date — as
// shadcn's separator Marker.
export default function ChatDaySeparator({ at }: { at: string }) {
  const t = useTranslations('chatWorkspace.messages');
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const day = dayKey(at);
  const label =
    day === today ? t('today') : day === yesterday ? t('yesterday') : formatLongDate(at);
  return (
    <Marker variant="separator" role="separator" className="py-2 text-xs">
      <MarkerContent>{label}</MarkerContent>
    </Marker>
  );
}
