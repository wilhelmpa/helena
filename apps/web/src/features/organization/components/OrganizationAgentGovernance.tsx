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
import { Stack, Text } from '@/design-system';

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
    <Stack gap={3} pad={3} className="rounded-md border">
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
          <Text as="span" size="xs" tone="muted" className="block">
            {t('dailyCeiling')}
          </Text>
          <Input
            inputMode="numeric"
            value={daily}
            placeholder={t('noCeiling')}
            aria-invalid={dailyCeiling === undefined}
            onChange={(event) => setDaily(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('monthlyCeiling')}
          </Text>
          <Input
            inputMode="numeric"
            value={monthly}
            placeholder={t('noCeiling')}
            aria-invalid={monthlyCeiling === undefined}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
      </div>
      <Text as="p" size="xs" tone="muted">
        {invalid ? t('invalid') : t('hint')}
      </Text>
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
    </Stack>
  );
}
