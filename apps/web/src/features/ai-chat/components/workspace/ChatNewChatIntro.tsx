'use client';

import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import { agentDisplayName } from '../../utils/agentChip';
import type { AiAgent } from '@/lib/api/endpoints/agents';

// A new chat before its first message: the selected agent's status and a short introduction. The agent is
// picked in one place only — the dropdown at the composer's bottom left, with its
// state — so there is nothing to choose here.
export default function ChatNewChatIntro({ agent }: { agent: AiAgent }) {
  const t = useTranslations('chatWorkspace');
  const displayName = agentDisplayName(agent, useDisplayName());

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-4 text-center">
      <span className="block aspect-square w-[min(20rem,55vw)] shrink-0" aria-hidden="true" />
      <p className="text-sm font-medium">{t('newChat.title', { agent: displayName })}</p>
    </div>
  );
}
