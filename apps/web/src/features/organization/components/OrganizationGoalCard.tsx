'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationGoalStatus,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useDeleteGoal, useUpdateGoal } from '../services/organization.service';
import OrganizationGoalProgress from './OrganizationGoalProgress';

export default function OrganizationGoalCard({
  teamId,
  goal,
  goals,
  departments,
  projects,
}: {
  teamId: number;
  goal: OrganizationGoal;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
}) {
  const t = useTranslations('organization');
  const update = useUpdateGoal(teamId);
  const remove = useDeleteGoal(teamId);
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const [status, setStatus] = useState<OrganizationGoalStatus>(goal.status);
  const [departmentId, setDepartmentId] = useState(goal.departmentId?.toString() ?? '');
  const [projectId, setProjectId] = useState(goal.projectId?.toString() ?? '');
  const [parentGoalId, setParentGoalId] = useState(goal.parentGoalId?.toString() ?? '');
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? '');

  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          id: goal.id,
          input: {
            title,
            description,
            status,
            departmentId: departmentId ? Number(departmentId) : null,
            projectId: projectId ? Number(projectId) : null,
            parentGoalId: parentGoalId ? Number(parentGoalId) : null,
            targetDate: targetDate || null,
          },
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('fields.title')}</span>
          <Input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('fields.status')}</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as OrganizationGoalStatus)}
          >
            {(['planned', 'active', 'achieved', 'paused'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`statuses.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('fields.department')}</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('fields.project')}</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.key} · {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('fields.parentGoal')}</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={parentGoalId}
            onChange={(event) => setParentGoalId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {goals
              .filter((candidate) => candidate.id !== goal.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label className="space-y-1 text-sm">
        <span className="block text-xs text-muted-foreground">{t('fields.targetDate')}</span>
        <Input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-xs text-muted-foreground">{t('fields.description')}</span>
        <Textarea
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <OrganizationGoalProgress teamId={teamId} goal={goal} />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate(goal.id)}
        >
          {t('actions.delete')}
        </Button>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={update.isPending || !title.trim()}
        >
          {t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
