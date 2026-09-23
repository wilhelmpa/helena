'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentRuntime } from '@/components/common/page/AgentAvatar';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatAgentLabel, ChatAgentState } from '../utils/agentPresence';

// Product names, not words: the same in every language.
const RUNTIME_NAME: Record<Exclude<AgentRuntime, 'external'>, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
};

// The words the chat uses for an agent's state: the one-word status, and the detail
// line under a picked agent — which engine runs it, on which model, and how it is doing.
export function useAgentStateText() {
  const t = useTranslations('chatWorkspace');

  const status = useCallback(
    (label: ChatAgentLabel): string => {
      switch (label) {
        case 'running':
          return t('agents.status.running');
        case 'waiting':
          return t('agents.status.waiting');
        case 'ready':
          return t('agents.status.ready');
        case 'offline':
          return t('agents.status.offline');
        case 'never':
          return t('agents.status.never');
        case 'paused':
          return t('agents.status.paused');
        case 'template':
          return t('agents.status.template');
      }
    },
    [t],
  );

  const runtime = useCallback(
    (value: AgentRuntime | null): string | null => {
      if (value == null) return null;
      return value === 'external' ? t('agents.runtimeExternal') : RUNTIME_NAME[value];
    },
    [t],
  );

  const detail = useCallback(
    (agent: Pick<AiAgent, 'model'>, state: ChatAgentState | undefined): string =>
      [
        runtime(state?.runtime ?? null),
        agent.model ?? t('composer.modelDefault'),
        state ? status(state.label) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [runtime, status, t],
  );

  return { status, runtime, detail };
}
