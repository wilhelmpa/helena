'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DecisionClassView,
  DecisionConnectionOption,
  FirstStageView,
} from '@/lib/api/endpoints/decisions';
import { useUpdateFirstStage } from '@/services/decisions.service';
import { FirstStageUseCases } from './FirstStageUseCases';

export function FirstStagePanel({
  teamId,
  policy,
  classes,
  connections,
}: {
  teamId: number;
  policy: FirstStageView;
  classes: DecisionClassView[];
  connections: DecisionConnectionOption[];
}) {
  const t = useTranslations('decisions.firstStage');
  const update = useUpdateFirstStage(teamId);
  const available = connections.filter(
    (entry) => ['typesafe', 'vercel'].includes(entry.provider) && entry.projectKey === null,
  );
  return (
    <section className="space-y-4 rounded-md border border-sidebar-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">{t('title')}</h2>
        <Switch
          checked={policy.enabled}
          disabled={update.isPending || (!policy.enabled && !policy.credentialId)}
          aria-label={t('title')}
          onCheckedChange={(enabled) => update.mutate({ enabled })}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{t('connection')}</span>
          <Select
            value={String(policy.credentialId ?? 'none')}
            disabled={update.isPending}
            onValueChange={(value) =>
              update.mutate({ credentialId: value === 'none' ? null : Number(value), useCases: {} })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('none')}</SelectItem>
              {available.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{t('timeout')}</span>
          <Input
            type="number"
            min={200}
            max={3000}
            step={100}
            key={policy.timeoutMs}
            defaultValue={policy.timeoutMs}
            disabled={update.isPending}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (
                Number.isInteger(value) &&
                value >= 200 &&
                value <= 3000 &&
                value !== policy.timeoutMs
              )
                update.mutate({ timeoutMs: value });
            }}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">{t('cloudHint')}</p>
      {policy.circuitOpen && (
        <p role="status" className="text-sm">
          {t('cooldown')}
        </p>
      )}
      <FirstStageUseCases
        teamId={teamId}
        policy={policy}
        classes={classes}
        pending={update.isPending}
        onUpdate={update.mutate}
      />
    </section>
  );
}
