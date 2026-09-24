'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
} from '@/components/ai-elements/queue';

export interface QueuedMessage {
  id: string;
  text: string;
}

// Messages written while an answer is still coming (old-chat parity): they wait over the
// field in order, each removable, and go out one by one as soon as the agent is done.
// After a failed answer the queue holds until the member sends again.
export default function ChatComposerQueue({
  queue,
  agentName,
  paused,
  onRemove,
}: {
  queue: QueuedMessage[];
  agentName: string;
  paused: boolean;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('chatWorkspace.composer');
  if (queue.length === 0) return null;
  return (
    <Queue aria-live="polite" aria-label={t('queuedList')}>
      {queue.map((message) => (
        <QueueItem key={message.id}>
          <QueueItemIndicator />
          <QueueItemContent dir="auto">{message.text}</QueueItemContent>
          <QueueItemDescription>
            {paused ? t('queuePaused') : t('queued', { agent: agentName })}
          </QueueItemDescription>
          <QueueItemAction label={t('removeQueued')} onClick={() => onRemove(message.id)}>
            <X />
          </QueueItemAction>
        </QueueItem>
      ))}
    </Queue>
  );
}
