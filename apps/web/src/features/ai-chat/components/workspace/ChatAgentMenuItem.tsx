'use client';

import { Check } from 'lucide-react';
import { useDisplayName } from '@/context/displayName';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { MenuItem, Text } from '@/design-system';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import type { ChatAgentState } from '../../utils/agentPresence';
import { agentDisplayName } from '../../utils/agentChip';
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
  const name = agentDisplayName(agent, useDisplayName());

  return (
    <MenuItem disabled={!selectable} onSelect={onPick} className="ds-agent-menu-item">
      <AgentAvatar name={name} runtime={state?.runtime ?? undefined} className="size-6" />
      <Orb state={status} motionEnabled={motionEnabled} />
      <span className="ds-agent-menu-item-text">
        <Text truncate>{name}</Text>
        <Text size="xs" tone="muted" truncate>
          {text.detail(agent, state)}
        </Text>
      </span>
      {current && <Check size={16} aria-hidden="true" />}
    </MenuItem>
  );
}
