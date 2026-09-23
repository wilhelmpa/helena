'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useSetAgentTokenCeilings } from '../services/organization.service';
import { parseCeiling } from '../utils/tokenCeilings';
import OrganizationAgentPause from './OrganizationAgentPause';
import OrganizationTokenUsage from './OrganizationTokenUsage';

// Whether the agent takes work, and what its runs may spend.
export default function OrganizationAgentGovernance({
  teamId,
  agent,
}: {
  teamId: number;
  agent: OrganizationAgent;
}) {
  const t = useTranslations('organization.tokens');
  const save = useSetAgentTokenCeilings(teamId);
  const [daily, setDaily] = useState(agent.dailyTokenCeiling?.toString() ?? '');
  const [monthly, setMonthly] = useState(agent.monthlyTokenCeiling?.toString() ?? '');
  const dailyCeiling = parseCeiling(daily);
  const monthlyCeiling = parseCeiling(monthly);
  const invalid = dailyCeiling === undefined || monthlyCeiling === undefined;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <OrganizationAgentPause teamId={teamId} agent={agent} />
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('dailyCeiling')}</span>
          <Input
            inputMode="numeric"
            value={daily}
            placeholder={t('noCeiling')}
            aria-invalid={dailyCeiling === undefined}
            onChange={(event) => setDaily(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('monthlyCeiling')}</span>
          <Input
            inputMode="numeric"
            value={monthly}
            placeholder={t('noCeiling')}
            aria-invalid={monthlyCeiling === undefined}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{invalid ? t('invalid') : t('hint')}</p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={invalid || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: agent.id,
                ceilings: { daily: dailyCeiling ?? null, monthly: monthlyCeiling ?? null },
              },
              { onSuccess: () => toast.success(t('saved', { name: agent.name })) },
            )
          }
        >
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
