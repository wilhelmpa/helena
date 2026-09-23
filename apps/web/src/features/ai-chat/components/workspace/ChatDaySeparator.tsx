'use client';

import { useTranslations } from 'next-intl';
import { dayKey, formatLongDate } from '@/utils/dates';

// The line between two days of a conversation: "Heute", "Gestern", or the date.
export default function ChatDaySeparator({ at }: { at: string }) {
  const t = useTranslations('chatWorkspace.messages');
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const day = dayKey(at);
  const label =
    day === today ? t('today') : day === yesterday ? t('yesterday') : formatLongDate(at);
  return (
    <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
