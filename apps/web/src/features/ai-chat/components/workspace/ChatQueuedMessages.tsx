'use client';

import { useTranslations } from 'next-intl';
import { Clock, X } from 'lucide-react';

export interface QueuedMessage {
  id: string;
  text: string;
}

// Messages written while an answer is still coming (owner parity with the old chat):
// they wait here in order, greyed, each removable, and go out one by one as soon as the
// agent is done. After a failed answer the queue holds until the member sends again.
export default function ChatQueuedMessages({
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
    <div className="space-y-1 px-2 pt-2" aria-live="polite">
      {queue.map((message) => (
        <div
          key={message.id}
          className="flex items-center gap-2 rounded-lg bg-accent/60 py-1 ps-2.5 pe-1 text-sm text-muted-foreground"
        >
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <span dir="auto" className="min-w-0 flex-1 truncate">
            {message.text}
          </span>
          <span className="shrink-0 text-xs">
            {paused ? t('queuePaused') : t('queued', { agent: agentName })}
          </span>
          <button
            type="button"
            onClick={() => onRemove(message.id)}
            aria-label={t('removeQueued')}
            title={t('removeQueued')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
