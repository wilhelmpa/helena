'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';
import ChatAgentMenuItem from './ChatAgentMenuItem';

// Who this chat is with, in the header: the agent's avatar with its presence and
// runtime, its name and its state. Opened, it lists every agent — picking one starts a
// new chat with it, since a chat stays with the agent it began with.
export default function ChatAgentMenu({
  agent,
  agents,
  states,
  onNewChat,
}: {
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  onNewChat: (agentId: number) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const text = useAgentStateText();
  const state = states.get(agent.id);
  const usable = agents.filter((candidate) => !candidate.template);
  const templates = agents.filter((candidate) => candidate.template);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-2 data-[state=open]:bg-sidebar-accent"
          aria-label={t('agents.switch', { agent: agent.name })}
        >
          <AgentAvatar
            name={agent.name}
            presence={state?.presence}
            runtime={state?.runtime ?? undefined}
            className="size-5 text-2xl"
          />
          <span className="hidden max-w-40 truncate font-medium @md/chat:inline">{agent.name}</span>
          {state && (
            <span className="hidden text-xs text-muted-foreground @2xl/chat:inline">
              {text.status(state.label)}
            </span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t('agents.newChatWith')}
        </DropdownMenuLabel>
        {usable.map((candidate) => (
          <ChatAgentMenuItem
            key={candidate.id}
            agent={candidate}
            state={states.get(candidate.id)}
            current={candidate.id === agent.id}
            onPick={() => onNewChat(candidate.id)}
          />
        ))}
        {templates.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              {t('agents.templates')}
            </DropdownMenuLabel>
            {templates.map((candidate) => (
              <ChatAgentMenuItem
                key={candidate.id}
                agent={candidate}
                state={states.get(candidate.id)}
                current={false}
                onPick={() => undefined}
              />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
