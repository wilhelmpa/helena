'use client';

import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type {
  DecisionClassView,
  FirstStagePolicy,
  FirstStageView,
} from '@/lib/api/endpoints/decisions';
import { useStartDecisionEval } from '@/services/decisions.service';

export function FirstStageUseCases({
  teamId,
  policy,
  classes,
  pending,
  onUpdate,
}: {
  teamId: number;
  policy: FirstStageView;
  classes: DecisionClassView[];
  pending: boolean;
  onUpdate: (patch: Partial<FirstStagePolicy>) => void;
}) {
  const t = useTranslations('decisions.firstStage');
  const all = useTranslations();
  const locale = useLocale();
  const evaluate = useStartDecisionEval(teamId);
  return (
    <div className="space-y-3">
      {classes
        .filter((cls) => cls.input.cloud === 'allowed')
        .map((cls) => {
          const check = policy.checks[cls.id];
          const selected =
            policy.useCases[cls.id]?.enabled === true &&
            policy.useCases[cls.id]?.cloudAllowed === true;
          const label = resolveText(cls.label, locale, (key) => all(key as never));
          let evalLabel = t('evaluate');
          if (check?.running) evalLabel = t('evaluating');
          else if (check?.ok) evalLabel = t('evaluateAgain');
          return (
            <div key={cls.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Switch
                  aria-label={t('allow', { name: label })}
                  checked={selected}
                  disabled={pending || !policy.credentialId || (!selected && !check?.ok)}
                  onCheckedChange={(enabled) =>
                    onUpdate({
                      useCases: {
                        [cls.id]: { enabled, cloudAllowed: enabled },
                      },
                    })
                  }
                />
                <span className="text-sm">{label}</span>
              </div>
              {cls.eval && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!policy.credentialId || evaluate.isPending || check?.running}
                  onClick={() =>
                    evaluate.mutate({ classId: cls.id, credentialId: policy.credentialId })
                  }
                >
                  {evalLabel}
                </Button>
              )}
            </div>
          );
        })}
    </div>
  );
}
