'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationDepartment, OrganizationProject } from '@/lib/api/endpoints/organization';
import {
  useClearProjectAssignment,
  useSetProjectAssignment,
} from '../services/organization.service';
import { Inline, Stack, Text } from '@/design-system';

export default function OrganizationProjectCard({
  teamId,
  project,
  departments,
}: {
  teamId: number;
  project: OrganizationProject;
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');
  const save = useSetProjectAssignment(teamId);
  const clear = useClearProjectAssignment(teamId);
  const [departmentId, setDepartmentId] = useState(project.departmentId?.toString() ?? '');
  const [instructions, setInstructions] = useState(project.instructions);

  return (
    <Stack
      as="form"
      gap={3}
      pad={4}
      className="rounded-md border bg-card"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          id: project.id,
          input: {
            departmentId: departmentId ? Number(departmentId) : null,
            instructions,
          },
        });
      }}
    >
      <div>
        <h3 className="text-md font-medium" dir="auto">
          {project.name}
        </h3>
        <Text as="p" size="xs" tone="muted">
          {project.key}
        </Text>
      </div>
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
          {t('fields.projectInstructions')}
        </Text>
        <Textarea
          value={instructions}
          maxLength={4000}
          placeholder={t('projects.instructionsPlaceholder')}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <Inline gap={2} justify="end" align="stretch">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate(project.id)}
        >
          {t('actions.clearAssignment')}
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={save.isPending}>
          {t('actions.save')}
        </Button>
      </Inline>
    </Stack>
  );
}
