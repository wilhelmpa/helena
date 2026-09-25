'use client';

import type { ReactNode } from 'react';
import { Blocks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { useRuntimeActionsQuery } from '../../services/agentLearning.service';
import type { AgentFormValue } from '../../utils/agentForm';
import { templateToolsets } from '../../utils/agentAbilities';
import { canActOnLearning } from '../../utils/agentLearning';
import { AgentFormSection } from './AgentFormSection';
import AgentChatReflections from './AgentChatReflections';
import AgentLearningSettings from './AgentLearningSettings';
import AgentSkillClashes from './AgentSkillClashes';
import AgentProfileSync from './AgentProfileSync';
import AgentRuntimeNotices from './AgentRuntimeNotices';
import AgentSkillInventory from './AgentSkillInventory';
import AgentToolsetList from './AgentToolsetList';

// What the agent can do in Hermes, as its runner last reported it. Hermes owns the
// toolsets, the MCP servers of its configuration and the skills; the owner turns
// toolsets, those servers and skills off, adds servers of the team's library, decides
// whether the agent learns, and acts on what it learned. The memory has its own tab.
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
  // A template runs nowhere, so no runner reports what it has: it offers the toolsets
  // of the team's runners, where its copies will run, and denies them for every copy.
  const isTemplate = agent?.template === true;
  const teamAgents = useAiAgentsQuery(isTemplate ? teamId : null).data;
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
      {agent && !isTemplate && (policy.runtime ?? 'hermes') === 'hermes' && (
        <AgentChatReflections teamId={teamId} agentId={agent.id} />
      )}
      {agent && agent.kind === 'external' && !isTemplate && (
        <AgentProfileSync teamId={teamId} agentId={agent.id} canEdit={canEdit} />
      )}
      {agent && !isTemplate && <AgentRuntimeNotices state={agent.runtimeState} />}
      {isTemplate ? (
        <>
          <AgentToolsetList
            title={t('toolsets')}
            hint={canEdit ? t('templateToolsetsHint') : t('toolsetsReadOnly')}
            empty={t('noToolsets')}
            toolsets={templateToolsets(teamAgents ?? [], policy.toolDeny)}
            denied={policy.toolDeny}
            canEdit={canEdit}
            onChange={(toolDeny) => onChange({ runtimePolicy: { ...policy, toolDeny } })}
          />
          {mcpServersContent}
        </>
      ) : !inventory ? (
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
          <AgentSkillClashes skills={inventory.skills} />
          <AgentSkillInventory
            skills={inventory.skills}
            disabled={policy.skillsDisabled ?? []}
            onDisabledChange={
              canEdit
                ? (skillsDisabled) => onChange({ runtimePolicy: { ...policy, skillsDisabled } })
                : null
            }
            learned={
              actingAgent === null
                ? null
                : { agentId: actingAgent, actions, onPromoted: onSkillPromoted }
            }
          />
        </>
      )}
    </AgentFormSection>
  );
}
