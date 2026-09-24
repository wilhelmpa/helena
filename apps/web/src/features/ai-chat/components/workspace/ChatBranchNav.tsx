'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MessageAction } from '@/components/ai-elements/message';
import type { PlanUIMessage } from '../../utils/chatMessages';

// The versions of an edited question or a regenerated answer: siblings of the same
// parent, oldest first. Only shown once there is more than one — most messages have no
// history to browse.
export default function ChatBranchNav({
  message,
  onSwitchVersion,
}: {
  message: PlanUIMessage;
  onSwitchVersion: (messageId: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const siblings = message.metadata?.siblingIds ?? [];
  if (siblings.length < 2) return null;

  const index = Math.max(0, siblings.indexOf(message.id));

  return (
    <div className="flex items-center gap-0.5" dir="ltr">
      <MessageAction
        label={t('messages.previousVersion')}
        disabled={index === 0}
        onClick={() => onSwitchVersion(siblings[index - 1])}
      >
        <ChevronLeft />
      </MessageAction>
      <span className="min-w-8 text-center text-xs text-muted-foreground tabular-nums">
        {index + 1}/{siblings.length}
      </span>
      <MessageAction
        label={t('messages.nextVersion')}
        disabled={index === siblings.length - 1}
        onClick={() => onSwitchVersion(siblings[index + 1])}
      >
        <ChevronRight />
      </MessageAction>
    </div>
  );
}
