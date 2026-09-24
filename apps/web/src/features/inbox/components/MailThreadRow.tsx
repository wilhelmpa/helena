'use client';

import { useTranslations } from 'next-intl';
import { CircleAlert, Paperclip, Reply, Sparkles, Star } from 'lucide-react';
import type { MailThreadRow as Row } from '@/lib/api/endpoints/mail';
import { cn } from '@/lib/utils';
import { mailListDate } from '../utils/mailDates';

export default function MailThreadRow({
  row,
  selected,
  showProject,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  showProject: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('mail.inbox');
  const tTriage = useTranslations('mail.triage');
  const triage = row.triage;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        'flex h-full w-full flex-col gap-0.5 border-b px-3 py-2 text-start text-sm hover:bg-accent/60',
        selected && 'bg-accent',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-label={row.unread ? t('unreadMarker') : undefined}
          className={cn(
            'size-2 shrink-0 rounded-full',
            row.unread ? 'bg-primary' : 'bg-transparent',
          )}
        />
        <span dir="auto" className={cn('min-w-0 flex-1 truncate', row.unread && 'font-semibold')}>
          {row.fromName || row.fromAddress}
          {row.messageCount > 1 && (
            <span className="ms-1 text-xs text-muted-foreground">{row.messageCount}</span>
          )}
        </span>
        {triage?.priority === 'high' && (
          <CircleAlert
            aria-label={tTriage('priorities.high')}
            className="size-3.5 shrink-0 text-status-danger"
          />
        )}
        {triage?.needsReply && (
          <Reply
            aria-label={tTriage('needsReply')}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {row.flagged && <Star className="size-3.5 shrink-0 fill-current text-amber-500" />}
        {row.hasAttachments && (
          <Paperclip
            aria-label={t('hasAttachments')}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {mailListDate(row.lastMessageAt)}
        </span>
      </span>
      <span dir="auto" className={cn('truncate ps-4', row.unread && 'font-medium')}>
        {row.subject || t('noSubject')}
      </span>
      <span className="flex items-center gap-1.5 ps-4 text-xs text-muted-foreground">
        {showProject && (
          <span className="shrink-0 rounded border px-1 font-mono text-xs leading-4">
            {row.projectKey ?? t('home')}
          </span>
        )}
        {triage?.category && (
          <span className="shrink-0 rounded border px-1 leading-4">
            {tTriage(`categories.${triage.category}` as never)}
          </span>
        )}
        {row.suggestedProjectKey && (
          <span className="flex shrink-0 items-center gap-0.5" title={t('suggested')}>
            <Sparkles className="size-3" />
            {row.suggestedProjectKey}
          </span>
        )}
        <span dir="auto" className="truncate">
          {row.snippet}
        </span>
      </span>
    </button>
  );
}
