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
import { Inline, Stack, Text } from '@/design-system';

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
    <Stack
      as="form"
      gap={3}
      pad={4}
      className="rounded-md border bg-card"
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
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.title')}
          </Text>
          <Input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.status')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
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
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.department')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
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
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.project')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
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
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.parentGoal')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
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
        <Text as="span" size="xs" tone="muted" className="block">
          {t('fields.targetDate')}
        </Text>
        <Input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </label>
      <label className="space-y-1 text-sm">
        <Text as="span" size="xs" tone="muted" className="block">
          {t('fields.description')}
        </Text>
        <Textarea
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <OrganizationGoalProgress teamId={teamId} goal={goal} />
      <Inline gap={2} justify="end" align="stretch">
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
      </Inline>
    </Stack>
  );
}
