'use client';

import type { ReactNode } from 'react';
import { Blocks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import { templateToolsets } from '../../utils/agentAbilities';
import { AgentFormSection } from './AgentFormSection';
import AgentSkillClashes from './AgentSkillClashes';
import AgentProfileSync from './AgentProfileSync';
import AgentRuntimeNotices from './AgentRuntimeNotices';
import AgentToolsetList from './AgentToolsetList';

// What the agent can do besides skills: its toolsets and MCP servers as its runtime last
// reported them, which the owner turns off, the servers of the team's library he adds, and
// the state of its profile. Skills and memory have their own tabs, learning its own page.
export default function AgentAbilitiesSection({
  open,
  onOpenChange,
  agent,
  value,
  onChange,
  mcpServersContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AiAgent | null;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  // The servers of the team's library, built by the parent, which saves them.
  mcpServersContent: ReactNode;
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

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Blocks}
      title={t('title')}
      hint={t('hint')}
    >
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
        </>
      )}
    </AgentFormSection>
  );
}
