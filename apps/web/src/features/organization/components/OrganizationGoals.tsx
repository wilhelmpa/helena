'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/design-system';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useCreateGoal } from '../services/organization.service';
import OrganizationGoalCard from './OrganizationGoalCard';

export default function OrganizationGoals({
  teamId,
  goals,
  departments,
  projects,
}: {
  teamId: number;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
}) {
  const t = useTranslations('organization');
  const create = useCreateGoal(teamId);
  const [title, setTitle] = useState('');
  // The goals as their ladder (hub/pc-goal-ladder): each goal after its parent, indented
  // by its depth, with the chain of goals above it — so it reads what serves what.
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const chainOf = (goal: OrganizationGoal) => {
    const chain: string[] = [];
    let parent = goal.parentGoalId != null ? byId.get(goal.parentGoalId) : undefined;
    while (parent && chain.length < 8) {
      chain.unshift(parent.title);
      parent = parent.parentGoalId != null ? byId.get(parent.parentGoalId) : undefined;
    }
    return chain;
  };
  const ordered: { goal: OrganizationGoal; depth: number }[] = [];
  const visit = (parentId: number | null, depth: number) => {
    for (const goal of goals) {
      const parent =
        goal.parentGoalId != null && byId.has(goal.parentGoalId) ? goal.parentGoalId : null;
      if (parent !== parentId || ordered.some((item) => item.goal.id === goal.id)) continue;
      ordered.push({ goal, depth });
      visit(goal.id, depth + 1);
    }
  };
  visit(null, 0);

  return (
    <div className="ds-goals">
      <form
        className="ds-goals-new"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { title },
            {
              onSuccess: () => setTitle(''),
            },
          );
        }}
      >
        <Input
          value={title}
          maxLength={160}
          placeholder={t('goals.newPlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending || !title.trim()}>
          {t('actions.add')}
        </Button>
      </form>
      {goals.length === 0 ? (
        <EmptyState>{t('goals.empty')}</EmptyState>
      ) : (
        <div className="ds-goals-list">
          {ordered.map(({ goal, depth }) => (
            <div
              key={`${goal.id}:${goal.updatedAt}`}
              className="ds-goal"
              style={{ '--ds-goal-depth': depth } as CSSProperties}
            >
              {chainOf(goal).length > 0 && (
                <span className="ds-goal-chain">{chainOf(goal).join(' › ')}</span>
              )}
              <OrganizationGoalCard
                teamId={teamId}
                goal={goal}
                goals={goals}
                departments={departments}
                projects={projects}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
