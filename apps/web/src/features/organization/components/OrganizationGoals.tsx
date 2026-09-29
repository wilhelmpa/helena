'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Target } from 'lucide-react';
import { Button, EmptyState } from '@/design-system';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { formatShortDate } from '@/utils/dates';
import OrganizationGoalDetail from './OrganizationGoalDetail';
import OrganizationGoalDialog from './OrganizationGoalDialog';

// The goals in the order of their ladder: each after the goal it serves, with its depth.
export function goalLadder(goals: OrganizationGoal[]) {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const ordered: { goal: OrganizationGoal; depth: number }[] = [];
  const seen = new Set<number>();
  const visit = (parentId: number | null, depth: number) => {
    for (const goal of goals) {
      const parent =
        goal.parentGoalId != null && byId.has(goal.parentGoalId) ? goal.parentGoalId : null;
      if (parent !== parentId || seen.has(goal.id)) continue;
      seen.add(goal.id);
      ordered.push({ goal, depth });
      visit(goal.id, depth + 1);
    }
  };
  visit(null, 0);
  // Goals caught in a circle of parents still get listed, at the top level.
  for (const goal of goals) if (!seen.has(goal.id)) ordered.push({ goal, depth: 0 });
  return ordered;
}

// Helena › Ziele (owner, 28.09., O11): two columns — the goals as cards in the order of their
// ladder on the left, the chosen goal on the right. "Neues Ziel" is the page's one action (the
// compact create dialog with chips). On a phone the list and the goal take turns.
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
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const ordered = goalLadder(goals);
  const requested = Number(params.get('goal'));
  const chosen = goals.find((goal) => goal.id === requested) ?? null;
  // Without a choice the first goal shows on a wide screen; the phone shows the list.
  const selected = chosen ?? ordered[0]?.goal ?? null;
  const select = (goalId: number | null) => {
    const next = new URLSearchParams(params);
    if (goalId == null) next.delete('goal');
    else next.set('goal', String(goalId));
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const scopeOf = (goal: OrganizationGoal) => {
    const project = projects.find((item) => item.id === goal.projectId);
    const department = departments.find((item) => item.id === goal.departmentId);
    return [department?.name, project?.name].filter(Boolean).join(' · ') || t('goals.wholeTeam');
  };

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
        <EmptyState
          icon={<Target />}
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              {t('goals.new')}
            </Button>
          }
        >
          {t('goals.empty')}
        </EmptyState>
      ) : (
        <div className="ds-goals-split" data-chosen={chosen ? 'true' : 'false'}>
          <nav className="ds-goals-list" aria-label={t('goals.list')}>
            {ordered.map(({ goal, depth }) => {
              const progress = goal.progress ?? { total: 0, done: 0, agents: [] };
              const percent =
                progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
              return (
                <button
                  key={goal.id}
                  type="button"
                  className="ds-goal-card"
                  aria-current={goal.id === selected?.id ? 'true' : undefined}
                  style={{ '--ds-goal-depth': depth } as CSSProperties}
                  onClick={() => select(goal.id)}
                >
                  <span className="ds-goal-card-head">
                    <span className="ds-goal-card-dot" data-status={goal.status} />
                    <span className="ds-goal-card-title">{goal.title}</span>
                    {(goal.pendingProposals ?? 0) > 0 && (
                      <span className="ds-goal-card-flag" title={t('goals.proposalsWaiting')}>
                        {goal.pendingProposals}
                      </span>
                    )}
                  </span>
                  <span className="ds-goal-card-meta">
                    <span>{t(`statuses.${goal.status}`)}</span>
                    <span>{scopeOf(goal)}</span>
                    {goal.targetDate && <span>{formatShortDate(goal.targetDate)}</span>}
                  </span>
                  {progress.total > 0 && (
                    <span
                      className="ds-goal-card-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-label={t('goals.progress', {
                        done: progress.done,
                        total: progress.total,
                      })}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <section className="ds-goals-detail">
            {selected && (
              <OrganizationGoalDetail
                key={selected.id}
                teamId={teamId}
                goal={selected}
                goals={goals}
                departments={departments}
                projects={projects}
                onSelect={select}
                onBack={() => select(null)}
                onDeleted={() => select(null)}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
