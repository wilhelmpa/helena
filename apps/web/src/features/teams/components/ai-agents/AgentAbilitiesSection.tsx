'use client';

import { Blocks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAgentCan } from '../../context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import AgentMemoryFiles from './AgentMemoryFiles';
import AgentSkillInventory from './AgentSkillInventory';
import AgentToolsetList from './AgentToolsetList';

// What the agent can do in Hermes, as its runner last reported it. Hermes owns the
// toolsets, MCP servers, skills and memory; the owner can only turn toolsets off.
export default function AgentAbilitiesSection({
  open,
  onOpenChange,
  agent,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AiAgent | null;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
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
        <p className="text-sm text-muted-foreground">{t('notReported')}</p>
      ) : (
        <>
          <AgentToolsetList
            toolsets={inventory.toolsets}
            denied={policy.toolDeny}
            canEdit={canEdit}
            onChange={(toolDeny) => onChange({ runtimePolicy: { ...policy, toolDeny } })}
          />
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">{t('mcpServers')}</p>
              <p className="text-xs text-muted-foreground">{t('mcpServersHint')}</p>
            </div>
            {inventory.mcpServers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noMcpServers')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {inventory.mcpServers.map((name) => (
                  <Badge key={name} variant="outline" className="font-mono">
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <AgentSkillInventory skills={inventory.skills} />
          <AgentMemoryFiles memory={inventory.memory} />
        </>
      )}
    </AgentFormSection>
  );
}
