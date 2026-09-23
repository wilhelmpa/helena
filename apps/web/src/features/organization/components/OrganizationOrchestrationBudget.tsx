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
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">{t('tokens.projectTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('tokens.projectDescription')}</p>
      </div>
      <OrganizationTokenUsage
        label={t('tokens.thisMonth')}
        used={project.tokensThisMonth}
        ceiling={project.monthlyTokenCeiling}
      />
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span className="text-muted-foreground">{t('tokens.monthlyCeiling')}</span>
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
      </div>
      {ceiling === undefined && (
        <p className="text-xs text-muted-foreground">{t('tokens.invalid')}</p>
      )}
      <OrganizationOrchestrationAgentUsage agents={agents} />
    </section>
  );
}
