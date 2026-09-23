'use client';

import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar, { PRESENCE_STATUS } from '@/components/common/page/AgentAvatar';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';
import ChatAgentChip from './ChatAgentChip';

// A new chat before its first message, claude.ai-style: who it will be with, large, and
// the agents to pick from right under it — each with its presence and runtime, so the
// choice is made knowing who is there to answer. Picking another agent here only
// changes who the new chat is with; nothing has been sent yet.
export default function ChatNewChatIntro({
  agent,
  agents,
  states,
  onPick,
}: {
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  onPick: (agentId: number) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const text = useAgentStateText();
  const state = states.get(agent.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-6 pb-4">
      {/* mt-auto rather than justify-end: pushed to the bottom while there is room,
          and still scrollable from its top when there is not. */}
      <div className="mx-auto mt-auto flex w-full max-w-3xl flex-col items-center gap-4 text-center">
        <AgentAvatar
          name={agent.name}
          presence={state?.presence}
          runtime={state?.runtime ?? undefined}
          className="size-10 text-4xl"
        />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('newChat.title', { agent: agent.name })}
          </h2>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            {state && <StatusBadge status={PRESENCE_STATUS[state.presence]} dotOnly />}
            {text.detail(agent, state)}
          </p>
          {state && !state.online && state.selectable && (
            <p className="text-xs text-muted-foreground">{t('newChat.offlineHint')}</p>
          )}
        </div>
        {agents.length > 1 && (
          <div
            role="group"
            aria-label={t('newChat.pickAgent')}
            className="flex max-w-2xl flex-wrap justify-center gap-1.5"
          >
            {agents.map((candidate) => (
              <ChatAgentChip
                key={candidate.id}
                agent={candidate}
                state={states.get(candidate.id)}
                selected={candidate.id === agent.id}
                onPick={() => onPick(candidate.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
