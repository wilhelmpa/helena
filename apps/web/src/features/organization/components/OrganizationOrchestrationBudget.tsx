'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrganizationAgent, OrganizationProject } from '@/lib/api/endpoints/organization';
import { useSetProjectTokenCeiling } from '../services/organization.service';
import { parseCeiling } from '../utils/tokenCeilings';
import OrganizationOrchestrationAgentUsage from './OrganizationOrchestrationAgentUsage';
import OrganizationTokenUsage from './OrganizationTokenUsage';
import { Inline, Text, Card } from '@/design-system';

// The tokens the project's agent runs used this month against its ceiling, and what each
// of its agents used against theirs.
export default function OrganizationOrchestrationBudget({
  teamId,
  project,
  agents,
}: {
  teamId: number;
  project: OrganizationProject;
  agents: OrganizationAgent[];
}) {
  const t = useTranslations('organization');
  const save = useSetProjectTokenCeiling(teamId);
  const [monthly, setMonthly] = useState(project.monthlyTokenCeiling?.toString() ?? '');
  const ceiling = parseCeiling(monthly);

  return (
    <Card as="section">
      <div>
        <h2 className="text-md font-medium">{t('tokens.projectTitle')}</h2>
        <Text as="p" size="xs" tone="muted">
          {t('tokens.projectDescription')}
        </Text>
      </div>
      <OrganizationTokenUsage
        label={t('tokens.thisMonth')}
        used={project.tokensThisMonth}
        ceiling={project.monthlyTokenCeiling}
      />
      <Inline gap={2} align="end">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('tokens.monthlyCeiling')}
          </Text>
          <Input
            inputMode="numeric"
            value={monthly}
            placeholder={t('tokens.noCeiling')}
            aria-invalid={ceiling === undefined}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={ceiling === undefined || save.isPending}
          onClick={() =>
            save.mutate(
              { projectId: project.id, monthly: ceiling ?? null },
              { onSuccess: () => toast.success(t('tokens.projectSaved', { name: project.name })) },
            )
          }
        >
          {t('actions.save')}
        </Button>
      </Inline>
      {ceiling === undefined && (
        <Text as="p" size="xs" tone="muted">
          {t('tokens.invalid')}
        </Text>
      )}
      <OrganizationOrchestrationAgentUsage agents={agents} />
    </Card>
  );
}
