'use client';

import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import OrganizationTokenUsage from './OrganizationTokenUsage';

// What each agent of the project used against its own ceilings.
export default function OrganizationOrchestrationAgentUsage({
  agents,
}: {
  agents: OrganizationAgent[];
}) {
  const t = useTranslations('organization.tokens');
  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('agentsTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('agentsHint')}</p>
      </div>
      <ul className="space-y-3">
        {agents.map((agent) => (
          <li key={agent.id} className="space-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium" dir="auto">
                {agent.name}
              </span>
              <AgentPausedBadge agent={agent} />
            </div>
            <OrganizationTokenUsage
              label={t('today')}
              used={agent.tokensToday}
              ceiling={agent.dailyTokenCeiling}
            />
            <OrganizationTokenUsage
              label={t('thisMonth')}
              used={agent.tokensThisMonth}
              ceiling={agent.monthlyTokenCeiling}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
