'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { AgentTeamPolicyDraft } from './agentTeamPolicy';

// The limits of the agent-team workflow: where an accepted result goes, whether the
// coordinator reviews, and the Hermes turns and time each stage may use.
export default function ControlPlaneAgentTeamPolicy({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AgentTeamPolicyDraft;
  onChange: (value: AgentTeamPolicyDraft) => void;
}) {
  const t = useTranslations('settings.actions.controlPlane.agentTeam');

  return (
    <fieldset className="grid gap-3 sm:col-span-3 sm:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor={`${id}-autonomy`}>{t('result')}</Label>
        <select
          id={`${id}-autonomy`}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={value.autonomy}
          onChange={(event) => {
            const autonomy = event.target.value as AgentTeamPolicyDraft['autonomy'];
            onChange({
              ...value,
              autonomy,
              reviewRequired: autonomy === 'done' || value.reviewRequired,
            });
          }}
        >
          <option value="review">{t('autonomyReview')}</option>
          <option value="done">{t('autonomyDone')}</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-review`}>{t('review')}</Label>
        <div className="flex h-9 items-center">
          <Switch
            id={`${id}-review`}
            checked={value.reviewRequired}
            onCheckedChange={(reviewRequired) =>
              onChange({
                ...value,
                reviewRequired,
                autonomy: reviewRequired ? value.autonomy : 'review',
              })
            }
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-turns`}>{t('maxTurns')}</Label>
        <Input
          id={`${id}-turns`}
          type="number"
          min={1}
          max={200}
          placeholder={t('noLimit')}
          value={value.maxTurns}
          onChange={(event) => onChange({ ...value, maxTurns: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-budget`}>{t('budgetMinutes')}</Label>
        <Input
          id={`${id}-budget`}
          type="number"
          min={1}
          max={120}
          placeholder={t('noLimit')}
          value={value.budgetMinutes}
          onChange={(event) => onChange({ ...value, budgetMinutes: event.target.value })}
        />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-4">{t('hint')}</p>
    </fieldset>
  );
}
