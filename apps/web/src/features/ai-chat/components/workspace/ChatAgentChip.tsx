'use client';

import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';

// One agent to start a new chat with: its avatar with the presence dot and runtime
// code, and its name, as a pill. The picked one sits on the sidebar's accent; a
// template is shown, dashed and disabled, so it is clear why it cannot be picked.
export default function ChatAgentChip({
  agent,
  state,
  selected,
  onPick,
}: {
  agent: AiAgent;
  state: ChatAgentState | undefined;
  selected: boolean;
  onPick: () => void;
}) {
  const text = useAgentStateText();
  const selectable = state?.selectable ?? !agent.template;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={selectable ? onPick : undefined}
          aria-pressed={selected}
          aria-disabled={!selectable}
          className={cn(
            'inline-flex h-8 max-w-56 min-w-0 items-center gap-2 rounded-full border border-sidebar-border bg-background ps-1.5 pe-3 text-sm ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-2',
            selected && 'border-transparent bg-sidebar-accent font-medium',
            !selectable &&
              'cursor-not-allowed border-dashed text-muted-foreground hover:bg-background',
          )}
        >
          <AgentAvatar
            name={agent.name}
            presence={state?.presence}
            runtime={state?.runtime ?? undefined}
            className="size-5 text-2xl"
          />
          <span className="truncate">{agent.name}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        @{agent.username} · {text.detail(agent, state)}
      </TooltipContent>
    </Tooltip>
  );
}
