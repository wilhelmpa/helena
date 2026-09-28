'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';
import ChatAgentMenuItem from './ChatAgentMenuItem';
import styles from './HomeChatLanding.module.css';

// Who the chat is with, at the composer's bottom left: the agent's avatar with its
// status orb, name and state. Opened, it lists every agent with its runtime,
// model and state — picking another one starts a new chat with it, since a chat stays
// with the agent it began with.
export default function ChatAgentMenu({
  agent,
  agents,
  states,
  motionEnabled,
  selectedModel,
  pill = false,
  onPick,
}: {
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  motionEnabled: boolean;
  selectedModel: string | null;
  pill?: boolean;
  onPick: (agentId: number) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const text = useAgentStateText();
  const state = states.get(agent.id);
  const modelId = selectedModel ?? agent.model ?? '';
  const opusVersion = modelId.match(/opus[- ]?(\d+)[-.](\d+)/i);
  const homeModel = opusVersion
    ? `Opus ${opusVersion[1]}.${opusVersion[2]}`
    : modelId || 'Standard';
  const homeName = agent.name === 'Helena' ? 'Home' : agent.name;
  const status = useAgentStatus(agent.id, {
    run: state?.label,
    runtimeStatus: state?.online === false ? 'offline' : agent.runtimeState.status,
  });

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex h-8 min-w-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 data-[state=open]:bg-sidebar-accent ${pill ? styles.chip : 'rounded-md'}`}
          aria-label={t('agents.switch', { agent: agent.name })}
          title={`${agent.name} · ${text.detail(agent, state)}`}
        >
          {pill ? (
            <>
              <Orb state={status} size="dot" />
              <span className={styles.chipLabel}>{`${homeName} · ${homeModel}`}</span>
            </>
          ) : (
            <>
              <AgentAvatar name={agent.name} className="size-5 text-xl" />
              <Orb state={status} motionEnabled={motionEnabled} />
              <span className="hidden max-w-32 truncate text-foreground @md/composer:inline">
                {agent.name}
              </span>
              <ChevronDown className="size-3.5 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t('agents.newChatWith')}
        </DropdownMenuLabel>
        {agents.map((candidate) => (
          <ChatAgentMenuItem
            key={candidate.id}
            agent={candidate}
            state={states.get(candidate.id)}
            motionEnabled={motionEnabled}
            current={candidate.id === agent.id}
            onPick={() => onPick(candidate.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
