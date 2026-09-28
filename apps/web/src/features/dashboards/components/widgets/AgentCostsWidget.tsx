'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import BudgetBar from '@/components/helena/BudgetBar';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { getAgentUsage } from '@/lib/api/endpoints/agentRuntime';
import { getProjectAutopilot } from '@/lib/api/endpoints/autopilot';
import { compactTokens } from '@/utils/agentUsage';
import type { WidgetConfig } from '@/utils/dashboardWidgets';

const DAY_MS = 86_400_000;

// What the project's agents spent (hub/pc-costs): the total in euro and tokens over the
// chosen days, the project's budgets as bars, and the agents and goals that cost most.
export default function AgentCostsWidget({
  project,
  config,
}: {
  project: ProjectDetail;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards.agentCosts');
  const format = useFormatter();
  const days = config.days ?? 30;
  const [from] = useState(() =>
    new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - (days - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
  const { teamId, id: projectId, key } = project.project;
  const byAgent = useQuery({
    queryKey: ['agent-usage', teamId, projectId, 'agent', from],
    queryFn: () => getAgentUsage(teamId, { from, projectId, by: ['agent'] }),
    staleTime: 60_000,
  });
  const byGoal = useQuery({
    queryKey: ['agent-usage', teamId, projectId, 'goal', from],
    queryFn: () => getAgentUsage(teamId, { from, projectId, by: ['goal'] }),
    staleTime: 60_000,
  });
  const autopilot = useQuery({
    queryKey: ['project-autopilot', key],
    queryFn: () => getProjectAutopilot(key),
    staleTime: 60_000,
  });

  if (byAgent.isPending) {
    return (
      <div className="ds-stack">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  const euro = (value: number | null) =>
    value == null ? t('unpriced') : format.number(value, { style: 'currency', currency: 'EUR' });
  const total = byAgent.data?.total;
  const agents = [...(byAgent.data?.rows ?? [])]
    .sort((a, b) => (b.costEur ?? 0) - (a.costEur ?? 0))
    .slice(0, 5);
  const goals = [...(byGoal.data?.rows ?? [])]
    .filter((row) => row.goalId != null)
    .sort((a, b) => (b.costEur ?? 0) - (a.costEur ?? 0))
    .slice(0, 3);
  const budgets = autopilot.data?.budgets ?? [];

  return (
    <div className="ds-costs">
      <div className="ds-costs-total">
        <strong>{euro(total?.costEur ?? null)}</strong>
        <span>
          {t('tokens', {
            tokens: compactTokens((total?.inputTokens ?? 0) + (total?.outputTokens ?? 0)),
          })}
          {' · '}
          {t('days', { days })}
        </span>
      </div>
      {budgets.map((budget) => (
        <div key={budget.id} className="ds-costs-budget">
          <span>{t(`budget.${budget.metric}.${budget.period}`)}</span>
          <BudgetBar
            budget={budget}
            label={t('used', { percent: Math.round(budget.ratio * 100) })}
          />
        </div>
      ))}
      {agents.length > 0 && (
        <ul className="ds-costs-list">
          {agents.map((row) => (
            <li key={row.agentId ?? 'none'}>
              <span>{row.agentName ?? t('noAgent')}</span>
              <span>{euro(row.costEur)}</span>
            </li>
          ))}
        </ul>
      )}
      {goals.length > 0 && (
        <ul className="ds-costs-list">
          {goals.map((row) => (
            <li key={row.goalId}>
              <span>{row.goalTitle}</span>
              <span>{euro(row.costEur)}</span>
            </li>
          ))}
        </ul>
      )}
      {agents.length === 0 && <p className="ds-run-note">{t('empty')}</p>}
    </div>
  );
}
