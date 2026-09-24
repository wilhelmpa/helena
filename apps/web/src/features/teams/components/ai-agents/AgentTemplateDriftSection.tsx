'use client';

import { LayoutTemplate, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AiAgent, TemplateFieldGroup } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery, useResetAiAgentToTemplate } from '@/services/aiAgents.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';

// The seven groups a template copy follows (template-sync.ts on the API): Skills,
// Tools, MCP servers, approval rules, instructions, model + reasoning, and budgets.
const GROUPS: TemplateFieldGroup[] = [
  'skills',
  'tools',
  'mcpServers',
  'approvals',
  'instructions',
  'model',
  'budgets',
];

// Shown on a copy only (agent.sourceTemplateId set). A group the copy's owner changed
// by hand shows "weicht ab" with a reset action; the rest quietly follow the template
// the next time it changes — nothing to show for them beyond the plain group name.
export default function AgentTemplateDriftSection({ agent }: { agent: AiAgent }) {
  const t = useTranslations('teams.agents.templateSync');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  // The template library is already the query every agent picker in this team uses
  // (ProjectAgentTemplateDialog), so this reads the cache rather than adding a request.
  const agents = useAiAgentsQuery(teamId).data;
  const reset = useResetAiAgentToTemplate(teamId);

  if (agent.sourceTemplateId == null) return null;
  const template = agents?.find((a) => a.id === agent.sourceTemplateId);
  const overridden = new Set(agent.templateOverrides);

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <LayoutTemplate className="size-4 text-muted-foreground" />
        {template ? t('copyOf', { name: template.name }) : t('copyOfUnknown')}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {GROUPS.map((group) => {
          const isOverridden = overridden.has(group);
          return (
            <span key={group} className="inline-flex items-center gap-1">
              <Badge
                variant={isOverridden ? 'outline' : 'secondary'}
                className={isOverridden ? 'border-brand/50 text-brand' : undefined}
                title={isOverridden ? t('overriddenHint') : t('followsHint')}
              >
                {t(`groups.${group}`)}
                {isOverridden && (
                  <span className="text-xs text-muted-foreground">{t('overridden')}</span>
                )}
              </Badge>
              {isOverridden && canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate({ id: agent.id, group })}
                >
                  <RotateCcw className="size-3" />
                  {t('resetToTemplate')}
                </Button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
