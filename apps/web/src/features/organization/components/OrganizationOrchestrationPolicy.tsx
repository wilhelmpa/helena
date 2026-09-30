'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useProjectWorkflows } from '@/services/controlPlaneWorkflows.service';
import { workflowsPath } from '@/utils/paths';
import { Inline, Text, Card } from '@/design-system';

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
  const coordinators = agents.filter((agent) => agent.role === 'coordinator').length;
  const specialists = agents.filter((agent) => agent.role === 'specialist').length;
  const warnings = [
    coordinators === 0 && t('warnings.noCoordinator'),
    coordinators > 1 && t('warnings.severalCoordinators'),
    coordinators > 0 && specialists === 0 && t('warnings.noSpecialists'),
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <Card as="section">
      <Inline gap={3} justify="between" align="start">
        <div>
          <h2 className="flex items-center gap-2 text-md font-medium">
            {t('policyTitle')}
            {flow && <Badge variant="outline">{enabled ? t('on') : t('off')}</Badge>}
          </h2>
          <Text as="p" size="xs" tone="muted">
            {t('policyDescription')}
          </Text>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={workflowsPath(projectKey)}>{t('configure')}</Link>
        </Button>
      </Inline>
      {workflows.isPending ? (
        <Text as="p" size="sm" tone="muted">
          {t('loading')}
        </Text>
      ) : !flow ? (
        <Text as="p" size="sm" tone="muted">
          {t('unavailable')}
        </Text>
      ) : !enabled ? (
        <Text as="p" size="sm" tone="muted">
          {t('offHint')}
        </Text>
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
          <Text
            as="p"
            size="xs"
            key={warning}
            className="flex gap-2 rounded-md bg-status-waiting/10 p-2 text-status-waiting"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {warning}
          </Text>
        ))}
    </Card>
  );
}
