'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useProjectWorkflows } from '@/services/controlPlaneWorkflows.service';
import { workflowsPath } from '@/utils/paths';

// Whether the project runs the agent-team workflow, with which limits, and what in the
// team keeps a delegated task from reaching it.
export default function OrganizationOrchestrationPolicy({
  projectKey,
  agents,
}: {
  projectKey: string;
  agents: OrganizationAgent[];
}) {
  const t = useTranslations('organization.orchestration');
  const workflows = useProjectWorkflows(projectKey);
  const flow = workflows.data?.find((item) => item.id === 'agent-team');
  const enabled = flow?.assignment.enabled ?? false;
  const config = flow?.assignment.configuration ?? {};
  const hermesAgents = agents.filter((agent) => agent.kind === 'external');
  const coordinators = hermesAgents.filter((agent) => agent.role === 'coordinator').length;
  const specialists = hermesAgents.filter((agent) => agent.role === 'specialist').length;
  const warnings = [
    coordinators === 0 && t('warnings.noCoordinator'),
    coordinators > 1 && t('warnings.severalCoordinators'),
    coordinators > 0 && specialists === 0 && t('warnings.noSpecialists'),
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-md font-medium">
            {t('policyTitle')}
            {flow && <Badge variant="outline">{enabled ? t('on') : t('off')}</Badge>}
          </h2>
          <p className="text-xs text-muted-foreground">{t('policyDescription')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={workflowsPath(projectKey)}>{t('configure')}</Link>
        </Button>
      </div>
      {workflows.isPending ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : !flow ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : !enabled ? (
        <p className="text-sm text-muted-foreground">{t('offHint')}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{t('result')}</dt>
          <dd>{config.autonomy === 'done' ? t('autonomyDone') : t('autonomyReview')}</dd>
          <dt className="text-muted-foreground">{t('review')}</dt>
          <dd>{config.reviewRequired === false ? t('reviewSkipped') : t('reviewRequired')}</dd>
          <dt className="text-muted-foreground">{t('maxTurns')}</dt>
          <dd>{config.maxTurns ?? t('noLimit')}</dd>
          <dt className="text-muted-foreground">{t('runBudget')}</dt>
          <dd>
            {config.runBudgetSeconds
              ? t('minutes', { count: Math.round(config.runBudgetSeconds / 60) })
              : t('noLimit')}
          </dd>
        </dl>
      )}
      {enabled &&
        warnings.map((warning) => (
          <p
            key={warning}
            className="flex gap-2 rounded-md bg-status-waiting/10 p-2 text-xs text-status-waiting"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {warning}
          </p>
        ))}
    </section>
  );
}
