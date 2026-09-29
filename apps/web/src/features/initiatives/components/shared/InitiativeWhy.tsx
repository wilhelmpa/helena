'use client';

import { useTranslations } from 'next-intl';
import { Target } from 'lucide-react';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { Pill } from '@/components/common/fields/Pill';
import { Inline, Text } from '@/design-system';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectGoalContext, useSetProjectPoolGoal } from '@/services/projectGoals.service';
import { poolGoalChain } from '../../utils/poolGoalChain';

// "Warum" of a project goal (owner, 28.09.: the goal ladder on the goals page): the Helena
// goal it serves with the goals above that one, and — for who may edit it — the choice of
// that goal among the ones the project may serve.
export default function InitiativeWhy({
  projectKey,
  initiativeId,
}: {
  projectKey: string;
  initiativeId: number;
}) {
  const t = useTranslations('initiatives');
  const { can } = usePermissions();
  const context = useProjectGoalContext(projectKey);
  const link = useSetProjectPoolGoal(projectKey);
  const chain = poolGoalChain(context.data, initiativeId);
  const goals = context.data?.goals ?? [];
  const editable = can('initiatives', 'edit') && goals.length > 0;

  const ladder = chain ? (
    <span className="ds-why">
      {chain.steps.map((step, index) => (
        <span key={`${index}:${step}`}>
          {index > 0 && <span className="ds-why-sep">›</span>}
          {step}
        </span>
      ))}
    </span>
  ) : (
    <Text tone="muted">{t('why.none')}</Text>
  );

  return (
    <Inline gap={3} wrap className="ds-initiative-why">
      <Text size="xs" tone="muted" weight="medium">
        {t('why.label')}
      </Text>
      {editable ? (
        <PopoverPick
          trigger={
            <Pill active={chain != null}>
              <Target />
              {chain ? chain.steps.join(' › ') : t('why.choose')}
            </Pill>
          }
          inputPlaceholder={t('why.choose')}
          contentClassName="w-80"
          items={[
            {
              key: 'none',
              search: t('why.noneOption'),
              icon: null,
              label: t('why.noneOption'),
              selected: chain == null,
              onSelect: () => link.mutate({ initiativeId, goalId: null }),
            },
            ...goals.map((goal) => ({
              key: String(goal.id),
              search: [...goal.path, goal.title].join(' '),
              icon: <Target />,
              label: [...goal.path, goal.title].join(' › '),
              selected: goal.id === chain?.goalId,
              onSelect: () => link.mutate({ initiativeId, goalId: goal.id }),
            })),
          ]}
        />
      ) : (
        ladder
      )}
    </Inline>
  );
}
