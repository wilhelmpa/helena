'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Target } from 'lucide-react';
import type { OrganizationGoal } from '@/lib/api/endpoints/organization';
import { Text } from '@/design-system';

// The goal's "Warum" (the goal ladder): the goals it serves, from the top down, the goal
// itself, and the goals that serve it — each a step one can open (owner, 28.09.: Ziel-Leiter
// on the goals page). A goal without either says it stands on its own.
export default function OrganizationGoalLadder({
  goal,
  goals,
  onSelect,
}: {
  goal: OrganizationGoal;
  goals: OrganizationGoal[];
  onSelect: (goalId: number) => void;
}) {
  const t = useTranslations('organization');
  const byId = new Map(goals.map((item) => [item.id, item]));
  const above: OrganizationGoal[] = [];
  let parent = goal.parentGoalId != null ? byId.get(goal.parentGoalId) : undefined;
  while (parent && above.length < 12 && !above.includes(parent)) {
    above.unshift(parent);
    parent = parent.parentGoalId != null ? byId.get(parent.parentGoalId) : undefined;
  }
  const below = goals.filter((item) => item.parentGoalId === goal.id);
  if (above.length === 0 && below.length === 0)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('goals.ladderAlone')}
      </Text>
    );

  return (
    <ol className="ds-ladder" aria-label={t('goals.ladder')}>
      {above.map((step, index) => (
        <li
          key={step.id}
          className="ds-ladder-step"
          style={{ '--ds-ladder-depth': index } as CSSProperties}
        >
          <button type="button" onClick={() => onSelect(step.id)}>
            <Target size={14} aria-hidden="true" />
            <span>{step.title}</span>
          </button>
        </li>
      ))}
      <li
        className="ds-ladder-step"
        data-current="true"
        aria-current="true"
        style={{ '--ds-ladder-depth': above.length } as CSSProperties}
      >
        <span className="ds-ladder-self">
          <Target size={14} aria-hidden="true" />
          <span>{goal.title}</span>
        </span>
      </li>
      {below.map((step) => (
        <li
          key={step.id}
          className="ds-ladder-step"
          data-below="true"
          style={{ '--ds-ladder-depth': above.length + 1 } as CSSProperties}
        >
          <button type="button" onClick={() => onSelect(step.id)}>
            <Target size={14} aria-hidden="true" />
            <span>{step.title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
