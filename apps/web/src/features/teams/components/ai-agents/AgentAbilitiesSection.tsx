'use client';

import type { ReactNode } from 'react';
import { Blocks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { useRuntimeActionsQuery } from '../../services/agentLearning.service';
import type { AgentFormValue } from '../../utils/agentForm';
import { canActOnLearning } from '../../utils/agentLearning';
import { AgentFormSection } from './AgentFormSection';
import AgentLearningSettings from './AgentLearningSettings';
import AgentMemoryFiles from './AgentMemoryFiles';
import AgentProfileSync from './AgentProfileSync';
import AgentRuntimeNotices from './AgentRuntimeNotices';
import AgentSkillInventory from './AgentSkillInventory';
import AgentToolsetList from './AgentToolsetList';

// What the agent can do in Hermes, as its runner last reported it. Hermes owns the
// toolsets, the MCP servers of its configuration, the skills and the memory; the owner
// turns toolsets and those servers off, adds servers of the team's library, decides
// whether the agent learns, and acts on what it learned.
export default function AgentAbilitiesSection({
  open,
  onOpenChange,
  agent,
  value,
  onChange,
  mcpServersContent,
  onSkillPromoted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AiAgent | null;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  // The servers of the team's library, built by the parent, which saves them.
  mcpServersContent: ReactNode;
  // A learned skill taken into the library is enabled on the agent; the parent, which
  // saves the agent's skills, keeps it enabled.
  onSkillPromoted: (skillId: number) => void;
}) {
  const t = useTranslations('teams.agents.abilities');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  const inventory = agent?.runtimeState.inventory ?? null;
  const policy = value.runtimePolicy;
  const actingAgent = agent && canActOnLearning(agent.runtimeState) ? agent.id : null;
  const actions = useRuntimeActionsQuery(teamId, actingAgent).data;

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Blocks}
      title={t('title')}
      hint={t('hint')}
    >
      <AgentLearningSettings
        policy={policy}
        canEdit={canEdit}
        onChange={(runtimePolicy) => onChange({ runtimePolicy })}
      />
      {agent && agent.kind === 'external' && !agent.template && (
        <AgentProfileSync teamId={teamId} agentId={agent.id} canEdit={canEdit} />
      )}
      {agent && <AgentRuntimeNotices state={agent.runtimeState} />}
      {!inventory ? (
        <>
          <p className="text-sm text-muted-foreground">{t('notReported')}</p>
          {mcpServersContent}
        </>
      ) : (
        <>
          <AgentToolsetList
            title={t('toolsets')}
            hint={canEdit ? t('toolsetsHint') : t('toolsetsReadOnly')}
            empty={t('noToolsets')}
            toolsets={inventory.toolsets}
            denied={policy.toolDeny}
            canEdit={canEdit}
            onChange={(toolDeny) => onChange({ runtimePolicy: { ...policy, toolDeny } })}
          />
          <AgentToolsetList
            title={t('mcpServers')}
            hint={canEdit ? t('mcpServersHint') : t('mcpServersReadOnly')}
            empty={t('noMcpServers')}
            toolsets={inventory.mcpServers}
            denied={policy.toolDeny}
            canEdit={canEdit}
            onChange={(toolDeny) => onChange({ runtimePolicy: { ...policy, toolDeny } })}
          />
          {mcpServersContent}
          <AgentSkillInventory
            skills={inventory.skills}
            learned={
              actingAgent === null
                ? null
                : { agentId: actingAgent, actions, onPromoted: onSkillPromoted }
            }
          />
          <AgentMemoryFiles
            memory={inventory.memory}
            controls={actingAgent === null || !canEdit ? null : { agentId: actingAgent, actions }}
          />
        </>
      )}
    </AgentFormSection>
  );
}
