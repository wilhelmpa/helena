'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';
import ChatAgentMenuItem from './ChatAgentMenuItem';

// Who the chat is with, at the composer's bottom left: the agent's avatar with its
// presence dot, its name and its state. Opened, it lists every agent with its runtime,
// model and state — picking another one starts a new chat with it, since a chat stays
// with the agent it began with.
export default function ChatAgentMenu({
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 data-[state=open]:bg-sidebar-accent"
          aria-label={t('agents.switch', { agent: agent.name })}
          title={`${agent.name} · ${text.detail(agent, state)}`}
        >
          <AgentAvatar name={agent.name} presence={state?.presence} className="size-5 text-xl" />
          <span className="hidden max-w-32 truncate text-foreground @md/composer:inline">
            {agent.name}
          </span>
          {state && (
            <span className="hidden truncate @xl/composer:inline">{text.status(state.label)}</span>
          )}
          <ChevronDown className="size-3.5 shrink-0" />
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
            current={candidate.id === agent.id}
            onPick={() => onPick(candidate.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
