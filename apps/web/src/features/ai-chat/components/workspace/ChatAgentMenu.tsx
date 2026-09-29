'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/design-system';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { runtimeChoice } from '@/components/helena/RuntimePicker';
import type { ChatAgentState } from '../../utils/agentPresence';
import { agentChipLabel, agentDisplayName } from '../../utils/agentChip';
import ChatAgentMenuItem from './ChatAgentMenuItem';
import ChatRuntimeDialog from './ChatRuntimeDialog';

// Who the chat is with, at the composer: the agent's status orb, its name and the model it
// answers with, as people call it — "Helena · Flash (lokal)" (owner, 28.09.) — and, when
// the last answer came from the fallback instead, that one. Opened, it lists every agent
// with its runtime, model and state; picking another one starts a new chat with it, since a
// chat stays with the agent it began with.
export default function ChatAgentMenu({
  scopeKey,
  agent,
  agents,
  states,
  motionEnabled,
  selectedModel,
  answeredBy,
  onPick,
}: {
  scopeKey: string;
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  motionEnabled: boolean;
  selectedModel: string | null;
  // The model that answered last in place of the chosen one (a local model's fallback).
  answeredBy?: string | null;
  onPick: (agentId: number) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const tr = useTranslations('chatWorkspace.runtimePicker');
  const state = states.get(agent.id);
  const status = useAgentStatus(agent.id, {
    run: state?.label,
    runtimeStatus: state?.online === false ? 'offline' : agent.runtimeState.status,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentRuntime = runtimeChoice(agent.runtimePolicy.runtime ?? 'hermes', agent.model);
  // Helena is always one click away (owner, 28.09., O41), also where a project's agent leads.
  const helena = agents.find((candidate) => candidate.agentRole === 'home');
  const chip = agentChipLabel(agent, selectedModel ?? agent.model, answeredBy, {
    local: (name) => t('composer.localModel', { name }),
    fallback: (name) => t('composer.fallbackModel', { name }),
    standard: t('composer.modelDefault'),
  });

  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            className="ds-agent-chip"
            aria-label={t('agents.switch', { agent: chip.name })}
            title={`${chip.name} · ${tr(currentRuntime)} · ${chip.model}`}
          >
            <Orb state={status} size="dot" motionEnabled={motionEnabled} />
            <span className="ds-agent-chip-label">{chip.label}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" side="top" className="ds-agent-menu">
          <MenuLabel>{t('agents.newChatWith')}</MenuLabel>
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
          <MenuSeparator />
          <MenuItem onSelect={() => setPickerOpen(true)}>{tr('change')}</MenuItem>
        </MenuContent>
      </Menu>
      {helena && helena.id !== agent.id && (
        <button
          type="button"
          className="ds-agent-chip"
          data-variant="quiet"
          onClick={() => onPick(helena.id)}
          title={t('agents.switchToHelena')}
        >
          <Orb state="idle" size="dot" motionEnabled={motionEnabled} />
          <span className="ds-agent-chip-label">{agentDisplayName(helena)}</span>
        </button>
      )}
      {pickerOpen && (
        <ChatRuntimeDialog
          scopeKey={scopeKey}
          agent={agent}
          onClose={() => setPickerOpen(false)}
          onConfirmed={() => onPick(agent.id)}
        />
      )}
    </>
  );
}
