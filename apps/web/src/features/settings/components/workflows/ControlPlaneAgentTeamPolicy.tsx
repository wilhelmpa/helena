'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AgentTeamPolicyDraft } from './agentTeamPolicy';

import { Stack, Text } from '@/design-system';

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
      <Stack gap={1}>
        <Label htmlFor={`${id}-autonomy`}>{t('result')}</Label>
        <Select
          value={value.autonomy}
          onValueChange={(next) => {
            const autonomy = next as AgentTeamPolicyDraft['autonomy'];
            onChange({
              ...value,
              autonomy,
              reviewRequired: autonomy === 'done' || value.reviewRequired,
            });
          }}
        >
          <SelectTrigger id={`${id}-autonomy`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="review">{t('autonomyReview')}</SelectItem>
            <SelectItem value="done">{t('autonomyDone')}</SelectItem>
          </SelectContent>
        </Select>
      </Stack>
      <Stack gap={1}>
        <Label htmlFor={`${id}-review`}>{t('review')}</Label>
        <div className="flex h-8 items-center">
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
      </Stack>
      <Stack gap={1}>
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
      </Stack>
      <Stack gap={1}>
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
      </Stack>
      <Text as="p" size="xs" tone="muted" className="sm:col-span-4">
        {t('hint')}
      </Text>
    </fieldset>
  );
}
