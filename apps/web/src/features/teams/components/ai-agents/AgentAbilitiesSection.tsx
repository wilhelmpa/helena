'use client';

import type { ReactNode } from 'react';
import { Blocks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAgentCan } from '../../context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import AgentMemoryFiles from './AgentMemoryFiles';
import AgentSkillInventory from './AgentSkillInventory';
import AgentToolsetList from './AgentToolsetList';

// What the agent can do in Hermes, as its runner last reported it. Hermes owns the
// toolsets, the MCP servers of its configuration, the skills and the memory; the owner
// turns toolsets and those servers off, and adds servers of the team's library.
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
  const canEdit = useAgentCan()('edit');
  const inventory = agent?.runtimeState.inventory ?? null;
  const policy = value.runtimePolicy;

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Blocks}
      title={t('title')}
      hint={t('hint')}
    >
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
          <AgentSkillInventory skills={inventory.skills} />
          <AgentMemoryFiles memory={inventory.memory} />
        </>
      )}
    </AgentFormSection>
  );
}
