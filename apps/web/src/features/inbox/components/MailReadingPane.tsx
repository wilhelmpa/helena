'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { MailDraftMode } from '@/lib/api/endpoints/mail';
import { useMailThread, useThreadAction } from '../services/mail.service';
import MailDraftChips from './MailDraftChips';
import MailMessageCard from './MailMessageCard';
import MailThreadHeader from './MailThreadHeader';
import MailThreadToolbar from './MailThreadToolbar';

// One thread, oldest message first, scrolled to the newest. Opening a thread marks
// it read.
export default function MailReadingPane({
  teamId,
  threadId,
  onBack,
  onDraft,
  onArchive,
  onMove,
  onRemoved,
}: {
  teamId: number;
  threadId: number;
  onBack: () => void;
  onDraft: (mode: MailDraftMode) => void;
  onArchive: () => void;
  onMove: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations('mail.thread');
  const thread = useMailThread(threadId);
  const markRead = useThreadAction(teamId).mutate;
  const markedRead = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const unread = thread.data?.messages.some((message) => !message.seen) ?? false;

  useEffect(() => {
    if (!unread || markedRead.current) return;
    markedRead.current = true;
    markRead({ threadId, action: 'read' });
  }, [unread, threadId, markRead]);

  const loaded = thread.data != null;
  useEffect(() => {
    if (loaded) endRef.current?.scrollIntoView({ block: 'end' });
  }, [loaded]);

  if (thread.isPending) return <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>;
  if (thread.isError || !thread.data)
    return <p className="p-4 text-sm text-destructive">{t('loadError')}</p>;

  const data = thread.data;
  return (
    <div className="flex min-h-0 w-full flex-col">
      <MailThreadToolbar
        thread={data}
        teamId={teamId}
        onBack={onBack}
        onDraft={onDraft}
        onArchive={onArchive}
        onMove={onMove}
        onRemoved={onRemoved}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MailThreadHeader thread={data} onMove={onMove} />
        <MailDraftChips drafts={data.drafts} />
        <div className="mt-4 flex flex-col gap-3">
          {data.messages.map((message) => (
            <MailMessageCard key={message.id} message={message} threadId={data.id} />
          ))}
        </div>
        <div ref={endRef} />
      </div>
    </div>
  );
}
