'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DecisionConnectionOption,
  FirstStagePolicy,
  FirstStageView,
} from '@/lib/api/endpoints/decisions';

export default function LocalAiJevConnection({
  policy,
  connections,
  pending,
  onSave,
}: {
  policy: FirstStageView;
  connections: DecisionConnectionOption[];
  pending: boolean;
  onSave: (patch: Partial<FirstStagePolicy>) => void;
}) {
  const t = useTranslations('localAi.jev');
  const available = connections.filter(
    (entry) => ['typesafe', 'vercel'].includes(entry.provider) && entry.projectKey === null,
  );
  const selected = available.find((entry) => entry.id === policy.credentialId);
  const state =
    selected?.status === 'ok'
      ? 'lastOk'
      : selected?.status === 'error' || selected?.status === 'needs_auth'
        ? 'lastFailed'
        : 'unverified';
  return (
    <div className="space-y-1">
      <Select
        value={String(policy.credentialId ?? 'none')}
        disabled={pending}
        onValueChange={(value) =>
          onSave({ credentialId: value === 'none' ? null : Number(value), useCases: {} })
        }
      >
        <SelectTrigger aria-label={t('connection')}>
          <SelectValue placeholder={t('noConnection')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('noConnection')}</SelectItem>
          {available.map((entry) => (
            <SelectItem key={entry.id} value={String(entry.id)}>
              {entry.label} · {entry.model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground" role="status">
        {!selected ? t('noConnection') : policy.circuitOpen ? t('cooldown') : t(state)}
      </p>
    </div>
  );
}
