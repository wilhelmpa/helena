'use client';

import WebLinkScope from '@/components/common/WebLinkScope';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { MailDraftMode } from '@/lib/api/endpoints/mail';
import { useMailThread, useThreadAction } from '../services/mail.service';
import MailDraftChips from './MailDraftChips';
import MailMessageCard from './MailMessageCard';
import MailThreadHeader from './MailThreadHeader';
import MailThreadToolbar from './MailThreadToolbar';
import { Box, Stack, Text } from '@/design-system';

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

  if (thread.isPending)
    return (
      <Text as="p" size="sm" tone="muted" className="p-4">
        {t('loading')}
      </Text>
    );
  if (thread.isError || !thread.data)
    return (
      <Text as="p" size="sm" tone="danger" className="p-4">
        {t('loadError')}
      </Text>
    );

  const data = thread.data;
  return (
    <WebLinkScope projectKey={data.projectKey}>
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
        <Box padX={4} padY={4} className="min-h-0 flex-1 overflow-y-auto">
          <MailThreadHeader thread={data} onMove={onMove} />
          <MailDraftChips drafts={data.drafts} />
          <Stack gap={3} marginTop={4}>
            {data.messages.map((message) => (
              <MailMessageCard key={message.id} message={message} threadId={data.id} />
            ))}
          </Stack>
          <div ref={endRef} />
        </Box>
      </div>
    </WebLinkScope>
  );
}
