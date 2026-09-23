'use client';

import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';

// Starting a new chat means picking who it is with, once. There is no agent switcher
// inside a conversation afterwards and no way to add a second agent to it — one agent
// per chat is the whole point of Helena's chat, not a limitation to work around.
//
// A pool template is filtered out regardless of what the caller passes in: it runs
// nowhere, so it can never actually answer — only a project's copy of it can. A
// project-scoped agent list already leaves templates out (they join no project), and
// the backend rejects a chat run against one outright, but this stays correct for any
// caller that has not filtered by project (e.g. a Home-wide picker).
export default function NewChatAgentPicker({
  open,
  onOpenChange,
  agents,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AiAgent[];
  onPick: (agentId: number) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const selectable = agents.filter((agent) => !agent.template);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('list.newChat')}</DialogTitle>
        </DialogHeader>
        <ul className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto">
          {selectable.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onPick(agent.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Bot className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{agent.name}</span>
                    <AgentPausedBadge agent={agent} />
                  </div>
                  <AgentRunnerStatus agent={agent} compact />
                </div>
              </button>
            </li>
          ))}
          {selectable.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">{t('empty.description')}</p>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
