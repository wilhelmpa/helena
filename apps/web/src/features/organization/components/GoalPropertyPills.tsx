'use client';

import { useTranslations } from 'next-intl';
import { Building2, CircleDot, FolderKanban, Target } from 'lucide-react';
import DatePill from '@/components/common/fields/DatePill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { Pill } from '@/components/common/fields/Pill';
import { Inline } from '@/design-system';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationGoalStatus,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';

export const GOAL_STATUSES: OrganizationGoalStatus[] = ['planned', 'active', 'achieved', 'paused'];

export interface GoalProperties {
  status: OrganizationGoalStatus;
  parentGoalId: number | null;
  departmentId: number | null;
  projectId: number | null;
  targetDate: string | null;
}

// The goals a goal may serve: every other goal but the ones below it (no circles).
export function parentCandidates(goals: OrganizationGoal[], goalId: number | null) {
  if (goalId == null) return goals;
  const below = new Set<number>([goalId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const goal of goals)
      if (goal.parentGoalId != null && below.has(goal.parentGoalId) && !below.has(goal.id)) {
        below.add(goal.id);
        grew = true;
      }
  }
  return goals.filter((goal) => !below.has(goal.id));
}

// A goal's properties as one row of chips (owner, 28.09.: the compact "Neues Ziel" dialog
// with chips is the model): status, the goal it serves, the department, the project and the
// target date. The same row in the create dialog and in a goal's detail, where each choice
// is saved at once.
export default function GoalPropertyPills({
  value,
  goalId,
  goals,
  departments,
  projects,
  onChange,
}: {
  value: GoalProperties;
  // The goal being edited (null while creating): it cannot serve itself or a goal below it.
  goalId: number | null;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
  onChange: (patch: Partial<GoalProperties>) => void;
}) {
  const t = useTranslations('organization');
  const candidates = parentCandidates(goals, goalId);
  const parent = goals.find((goal) => goal.id === value.parentGoalId);
  const department = departments.find((item) => item.id === value.departmentId);
  const project = projects.find((item) => item.id === value.projectId);
  const none = (selected: boolean, onSelect: () => void) => ({
    key: 'none',
    search: t('goals.none'),
    icon: null,
    label: t('goals.none'),
    selected,
    onSelect,
  });

  return (
    <Inline gap={2} wrap className="new-issue-pills">
      <PopoverPick
        trigger={
          <Pill active>
            <CircleDot />
            {t(`statuses.${value.status}`)}
          </Pill>
        }
        inputPlaceholder={t('fields.status')}
        items={GOAL_STATUSES.map((status) => ({
          key: status,
          search: t(`statuses.${status}`),
          icon: <CircleDot />,
          label: t(`statuses.${status}`),
          selected: status === value.status,
          onSelect: () => onChange({ status }),
        }))}
      />
      {candidates.length > 0 && (
        <PopoverPick
          trigger={
            <Pill active={parent != null}>
              <Target />
              {parent?.title ?? t('fields.parentGoal')}
            </Pill>
          }
          inputPlaceholder={t('fields.parentGoal')}
          contentClassName="w-72"
          items={[
            none(value.parentGoalId == null, () => onChange({ parentGoalId: null })),
            ...candidates.map((goal) => ({
              key: String(goal.id),
              search: goal.title,
              icon: <Target />,
              label: goal.title,
              selected: goal.id === value.parentGoalId,
              onSelect: () => onChange({ parentGoalId: goal.id }),
            })),
          ]}
        />
      )}
      {departments.length > 0 && (
        <PopoverPick
          trigger={
            <Pill active={department != null}>
              <Building2 />
              {department?.name ?? t('fields.department')}
            </Pill>
          }
          inputPlaceholder={t('fields.department')}
          items={[
            none(value.departmentId == null, () => onChange({ departmentId: null })),
            ...departments.map((item) => ({
              key: String(item.id),
              search: item.name,
              icon: <Building2 />,
              label: item.name,
              selected: item.id === value.departmentId,
              onSelect: () => onChange({ departmentId: item.id }),
            })),
          ]}
        />
      )}
      {projects.length > 0 && (
        <PopoverPick
          trigger={
            <Pill active={project != null}>
              <FolderKanban />
              {project?.name ?? t('fields.project')}
            </Pill>
          }
          inputPlaceholder={t('fields.project')}
          items={[
            none(value.projectId == null, () => onChange({ projectId: null })),
            ...projects.map((item) => ({
              key: String(item.id),
              search: `${item.key} ${item.name}`,
              icon: <FolderKanban />,
              label: item.name,
              selected: item.id === value.projectId,
              onSelect: () => onChange({ projectId: item.id }),
            })),
          ]}
        />
      )}
      <DatePill
        value={value.targetDate}
        placeholder={t('fields.targetDate')}
        onChange={(targetDate) => onChange({ targetDate })}
      />
    </Inline>
  );
}
