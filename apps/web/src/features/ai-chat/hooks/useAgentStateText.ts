'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentRuntime } from '@/components/common/page/AgentAvatar';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatAgentState } from '../utils/agentPresence';

// Product names, not words: the same in every language.
const RUNTIME_NAME: Record<Exclude<AgentRuntime, 'external'>, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
};

// Runtime and model detail under an agent in the picker.
export function useAgentStateText() {
  const t = useTranslations('chatWorkspace');

  const runtime = useCallback(
    (value: AgentRuntime | null): string | null => {
      if (value == null) return null;
      return value === 'external' ? t('agents.runtimeExternal') : RUNTIME_NAME[value];
    },
    [t],
  );

  const detail = useCallback(
    (agent: Pick<AiAgent, 'model'>, state: ChatAgentState | undefined): string =>
      [runtime(state?.runtime ?? null), agent.model ?? t('composer.modelDefault')]
        .filter(Boolean)
        .join(' · '),
    [runtime, t],
  );

  return { runtime, detail };
}
