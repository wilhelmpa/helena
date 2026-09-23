'use client';

import { Bot, PanelLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';

// Shown before an agent is picked: Home or a project with no open chat yet. One agent
// per chat, so starting one is choosing who it is with — no blank thread with an
// agent switcher, which would read as a group chat waiting to happen.
export default function ChatEmptyState({
  agents,
  onPick,
  onOpenList,
}: {
  agents: AiAgent[];
  onPick: (agentId: number) => void;
  onOpenList: () => void;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 w-fit @3xl/chat:hidden"
        onClick={onOpenList}
      >
        <PanelLeft className="size-4" /> {t('list.open')}
      </Button>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        {agents.length > 0 && (
          <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onPick(agent.id)}
                className="flex items-center gap-3 rounded-lg border p-3 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Bot className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{agent.name}</span>
                    <AgentPausedBadge agent={agent} />
                  </div>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{agent.username}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Empty>
    </div>
  );
}
