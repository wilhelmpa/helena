'use client';

import { Bot, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';
import { agentModelLabel } from '../../utils/agentModelLabel';

// The project's agents to pick from, as the content of a dropdown the host opens with
// its own trigger. An external agent shows the state of its runner instead of a model:
// it answers only while that runner is connected.
//
// A pool template is filtered out here regardless of what the caller passes in: it
// runs nowhere, so it can never actually answer a chat message — only a project's copy
// of it can. A project-scoped agent list already leaves templates out (they join no
// project), but this stays correct for a caller (e.g. a Home-wide picker) that has not
// filtered by project.
export function AiChatAgentMenu({
  agents,
  selectedId,
  providerLabel,
  onSelect,
}: {
  agents: AiAgent[];
  selectedId: number | null;
  providerLabel: (key: string) => string;
  onSelect: (agentId: number) => void;
}) {
  const t = useTranslations('aiChat');
  const selectable = agents.filter((agent) => !agent.template);

  return (
    <DropdownMenuContent align="start" className="w-64">
      <DropdownMenuLabel>{t('agents')}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {selectable.map((agent) => (
        <DropdownMenuItem key={agent.id} onSelect={() => onSelect(agent.id)} className="gap-2">
          <Bot className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm">{agent.name}</span>
              <AgentPausedBadge agent={agent} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {agent.kind === 'external' ? (
                <AgentRunnerStatus agent={agent} compact />
              ) : (
                agentModelLabel(agent, providerLabel, t('noModel'))
              )}
            </div>
          </div>
          {agent.id === selectedId && <Check className="size-4 shrink-0" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}
