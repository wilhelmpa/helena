'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTeamsQuery } from '@/services/teams.service';
import { useDecisionClassesQuery } from '@/services/decisions.service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/design-system';
import LocalAiJevPanel from './LocalAiJevPanel';

export default function JevToggle() {
  const t = useTranslations('localAi.jev');
  const teams = useTeamsQuery();
  const managed = (teams.data ?? []).filter((team) => ['owner', 'manager'].includes(team.role));
  const [chosen, setChosen] = useState<number | null>(null);
  const teamId = managed.find((team) => team.id === chosen)?.id ?? managed[0]?.id ?? null;
  const query = useDecisionClassesQuery(teamId);
  return (
    <Card as="section" tone="inset" pad="tight" aria-label={t('title')}>
      {managed.length > 1 && (
        <Select value={String(teamId)} onValueChange={(value) => setChosen(Number(value))}>
          <SelectTrigger aria-label={t('team')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {managed.map((team) => (
              <SelectItem key={team.id} value={String(team.id)}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {teams.isPending || (teamId !== null && query.isPending) ? (
        <p role="status">{t('loading')}</p>
      ) : teams.isError || query.isError ? (
        <p role="alert">{t('loadFailed')}</p>
      ) : teamId === null ? (
        <p>{t('managerOnly')}</p>
      ) : query.data ? (
        <LocalAiJevPanel key={teamId} teamId={teamId} data={query.data} />
      ) : null}
    </Card>
  );
}
