'use client';

import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import type { FirstStagePolicy, FirstStageView } from '@/lib/api/endpoints/decisions';

const classes = {
  mail: 'helena.mail',
  browser: 'helena.browser',
  tradingNews: 'helena.trading.news',
} as const;

export default function LocalAiJevUseCase({
  useCase,
  policy,
  pending,
  onSave,
}: {
  useCase: keyof typeof classes;
  policy: FirstStageView;
  pending: boolean;
  onSave: (patch: Partial<FirstStagePolicy>) => void;
}) {
  const t = useTranslations('localAi.jev');
  const classId = classes[useCase];
  const selected = policy.useCases[classId]?.enabled === true;
  const effective = policy.effective[classId];
  const check = policy.checks[classId];
  const reason = effective?.reason;
  const status =
    !selected && !check?.ok
      ? 'evalNeeded'
      : effective?.enabled
        ? 'effective'
        : reason === 'class_off'
          ? 'classOff'
          : reason === 'connection_blocked'
            ? 'blocked'
            : reason === 'cooldown'
              ? 'cooldown'
              : reason === 'no_eval' || reason === 'eval_failed' || reason === 'eval_threshold'
                ? 'evalNeeded'
                : reason === 'cloud_not_allowed'
                  ? 'cloudRequired'
                  : 'savedOff';
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="space-y-1">
        <p>{t(useCase)}</p>
        <p className="text-xs text-muted-foreground">{t(`${useCase}Hint`)}</p>
        <p className="text-xs" role="status">
          {t(status)}
        </p>
      </div>
      <Switch
        aria-label={t(useCase)}
        checked={selected}
        disabled={pending || (!selected && (!policy.credentialId || !check?.ok))}
        onCheckedChange={(enabled) =>
          onSave({ useCases: { [classId]: { enabled, cloudAllowed: enabled } } })
        }
      />
    </div>
  );
}
