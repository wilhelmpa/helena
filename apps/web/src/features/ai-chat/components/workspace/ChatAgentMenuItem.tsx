'use client';

import { Check } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { ChatAgentState } from '../../utils/agentPresence';
import { useAgentStateText } from '../../hooks/useAgentStateText';

// One agent in ChatAgentMenu: avatar, name, the runtime/model/state line under it, and
// a check on the one the chat is with. A template is listed, disabled.
export default function ChatAgentMenuItem({
  agent,
  state,
  motionEnabled,
  current,
  onPick,
}: {
  agent: AiAgent;
  state: ChatAgentState | undefined;
  motionEnabled: boolean;
  current: boolean;
  onPick: () => void;
}) {
  const text = useAgentStateText();
  const selectable = state?.selectable ?? !agent.template;
  const status = useAgentStatus(agent.id, {
    run: state?.label,
    runtimeStatus: state?.online === false ? 'offline' : agent.runtimeState.status,
  });

  return (
    <DropdownMenuItem disabled={!selectable} onSelect={onPick} className="gap-2 py-1.5">
      <AgentAvatar
        name={agent.name}
        runtime={state?.runtime ?? undefined}
        className="size-6 text-2xl"
      />
      <Orb state={status} motionEnabled={motionEnabled} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{agent.name}</div>
        <div className="truncate text-xs text-muted-foreground">{text.detail(agent, state)}</div>
      </div>
      {current && <Check className="size-4 shrink-0" />}
    </DropdownMenuItem>
  );
}
