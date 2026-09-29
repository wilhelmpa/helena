import { useContext } from 'react';
import { CircleDashed, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PopoverPick, Text, type PickGroup } from '@/design-system';
import { ShellCtx } from '@/context/shellContext';
import { useSortedGoalOptions } from '@/services/goalOptions.service';
import { qk } from '@/services/queryKeys';
import { createGoal, type GoalInput } from '@/lib/api/endpoints/organization';
import type { GoalRef } from '@/lib/api/endpoints/issues';
import type { ProjectPoolGoal } from '@/lib/api/endpoints/projectGoals';
import { GOAL_STATUS_META, goalsOfScope } from '@/utils/goalMeta';
import { colorDot } from '@/components/common/fields/colorDot';
import { Pill } from '@/components/common/fields/Pill';

// The "Ziel" of a task: the field pick list (PopoverPick) over the goals the task can serve —
// the project's own, its department's and the team-wide ones, grouped, searchable, each with the
// project's progress on it. A team owner or manager can name a goal that does not exist yet in
// the search field and create it right there (a goal of this project). `value` is the goal the
// task names itself; `legacy` is the title of an old project initiative the task still hangs
// under, shown only while no goal is chosen, so nothing it was linked to goes missing.
export default function GoalSelect({
  projectKey,
  projectId,
  teamId,
  value,
  legacy,
  onChange,
  readOnly,
}: {
  projectKey: string;
  projectId: number;
  teamId: number;
  value: GoalRef | null;
  legacy?: string | null;
  onChange: (goal: GoalRef | null) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations('issue.goalSelect');
  const tStatus = useTranslations('organization.statuses');
  // Creating a goal is for the team's owners and managers (the API's teamManager guard); a
  // project owner who is neither picks from the list only.
  const teamRole = useContext(ShellCtx)?.project?.viewer.teamRole;
  const canCreate = teamRole === 'owner' || teamRole === 'manager';
  const queryClient = useQueryClient();
  const goals = useSortedGoalOptions(projectKey, !readOnly);
  // The team's own goal lists and this picker both read what a new goal changes.
  const create = useMutation({
    mutationFn: (input: GoalInput) => createGoal(teamId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.organization(teamId) }),
  });
  const chosen = value ?? null;

  const item = (goal: ProjectPoolGoal) => ({
    key: String(goal.id),
    search: `${goal.title} ${goal.path.join(' ')}`,
    icon: colorDot(GOAL_STATUS_META[goal.status].color),
    label: goal.title,
    selected: goal.id === chosen?.id,
    tooltip: [...goal.path, goal.title].join(' › '),
    trailing: (
      <>
        {goal.status !== 'active' && (
          <Text size="xs" tone="muted">
            {tStatus(goal.status)}
          </Text>
        )}
        {goal.progress && goal.progress.total > 0 && (
          <Text size="xs" tone="muted" tabular title={t('progress', goal.progress)}>
            {goal.progress.done}/{goal.progress.total}
          </Text>
        )}
      </>
    ),
    onSelect: () => onChange({ id: goal.id, title: goal.title, status: goal.status }),
  });
  const groups: PickGroup[] = [
    { heading: t('scopeProject'), items: goalsOfScope(goals, 'project').map(item) },
    { heading: t('scopeDepartment'), items: goalsOfScope(goals, 'department').map(item) },
    { heading: t('scopeTeam'), items: goalsOfScope(goals, 'team').map(item) },
  ];

  return (
    <PopoverPick
      readOnly={readOnly}
      width="wide"
      trigger={
        <Pill
          active={chosen != null}
          title={!chosen && legacy ? t('legacy', { title: legacy }) : undefined}
        >
          {chosen ? (
            colorDot(GOAL_STATUS_META[chosen.status].color)
          ) : legacy ? (
            <Target />
          ) : (
            <CircleDashed />
          )}
          <span className="truncate">{chosen?.title ?? legacy ?? t('label')}</span>
        </Pill>
      }
      inputPlaceholder={t('search')}
      emptyText={t('empty')}
      items={[
        {
          key: 'none',
          search: t('none'),
          icon: <CircleDashed />,
          label: t('none'),
          selected: chosen == null,
          onSelect: () => onChange(null),
        },
      ]}
      groups={groups}
      create={
        canCreate
          ? {
              label: (title) => t('createNamed', { title }),
              create: async (title) => {
                const goal = await create.mutateAsync({ title, projectId, status: 'active' });
                await queryClient.invalidateQueries({ queryKey: qk.goalOptions(projectKey) });
                onChange({ id: goal.id, title: goal.title, status: goal.status });
              },
            }
          : undefined
      }
    />
  );
}
