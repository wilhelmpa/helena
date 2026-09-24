'use client';

import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';

// A new chat before its first message: a quiet line saying who it is with. The agent is
// picked in one place only — the dropdown at the composer's bottom left, with its
// state — so there is nothing to choose here.
export default function ChatNewChatIntro({ agent }: { agent: AiAgent }) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-4 text-center">
      <p className="text-sm font-medium">{t('newChat.title', { agent: agent.name })}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t('newChat.hint')}</p>
    </div>
  );
}
