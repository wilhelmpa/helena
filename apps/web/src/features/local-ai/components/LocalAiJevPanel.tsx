'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { listDecisionClasses } from '@/lib/api/endpoints/decisions';
import { useUpdateFirstStage } from '@/services/decisions.service';
import LocalAiJevConnection from './LocalAiJevConnection';
import LocalAiJevUseCase from './LocalAiJevUseCase';

export default function LocalAiJevPanel({
  teamId,
  data,
}: {
  teamId: number;
  data: Awaited<ReturnType<typeof listDecisionClasses>>;
}) {
  const t = useTranslations('localAi.jev');
  const save = useUpdateFirstStage(teamId);
  const policy = data.firstStage;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{t('title')}</h3>
        <Badge variant="outline">{t('cloud')}</Badge>
        <Switch
          aria-label={t('master')}
          checked={policy.enabled}
          disabled={save.isPending || (!policy.enabled && !policy.credentialId)}
          onCheckedChange={(enabled) => save.mutate({ enabled })}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <p className="text-xs" role="status">
        {policy.enabled ? t('savedOn') : t('savedOff')}
      </p>
      <LocalAiJevConnection
        policy={policy}
        connections={data.connections}
        pending={save.isPending}
        onSave={save.mutate}
      />
      {policy.enabled && (
        <div className="divide-y rounded-md border">
          {(['mail', 'browser', 'tradingNews'] as const).map((useCase) => (
            <LocalAiJevUseCase
              key={useCase}
              useCase={useCase}
              policy={policy}
              pending={save.isPending}
              onSave={save.mutate}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('scopeHint')}</p>
      <Link href="/decisions" className="text-xs underline underline-offset-2">
        {t('settings')}
      </Link>
    </div>
  );
}
