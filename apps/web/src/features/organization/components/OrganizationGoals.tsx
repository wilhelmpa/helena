'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { EmptyState } from '@/design-system';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import OrganizationGoalCard from './OrganizationGoalCard';
import OrganizationGoalDialog from './OrganizationGoalDialog';

// Helena › Ziele: the goals above the projects as their ladder, with "Neues Ziel" as the
// page's one action in the toolbar (the create dialog), like a project's Ziele.
export default function OrganizationGoals({
  teamId,
  goals,
  departments,
  projects,
  toolbarEnd,
}: {
  // The page's own control at the end of the toolbar (the team on Helena's page).
  toolbarEnd?: ReactNode;
  teamId: number;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
}) {
  const t = useTranslations('organization');
  const [creating, setCreating] = useState(false);
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
      <PageToolbar>
        <PageToolbarSpacer />
        {toolbarEnd}
        <PageActions
          primary={{
            id: 'new-goal',
            label: t('goals.new'),
            icon: Plus,
            onClick: () => setCreating(true),
          }}
        />
      </PageToolbar>
      {creating && (
        <OrganizationGoalDialog
          teamId={teamId}
          goals={goals}
          departments={departments}
          projects={projects}
          onClose={() => setCreating(false)}
        />
      )}
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
