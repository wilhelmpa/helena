'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useDeleteDepartment, useUpdateDepartment } from '../services/organization.service';
import DepartmentBudgets from './DepartmentBudgets';
import DepartmentSkills from './DepartmentSkills';
import DepartmentTemplateExport from './DepartmentTemplateExport';
import { Inline, Stack, Text } from '@/design-system';

export default function OrganizationDepartmentCard({
  teamId,
  department,
  departments,
}: {
  teamId: number;
  department: OrganizationDepartment;
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');
  const update = useUpdateDepartment(teamId);
  const remove = useDeleteDepartment(teamId);
  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description);
  const [parentId, setParentId] = useState(department.parentId?.toString() ?? '');

  return (
    <Stack
      as="form"
      gap={3}
      pad={4}
      className="rounded-md border bg-card"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          id: department.id,
          input: { name, description, parentId: parentId ? Number(parentId) : null },
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.name')}
          </Text>
          <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.parentDepartment')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {departments
              .filter((candidate) => candidate.id !== department.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label className="space-y-1 text-sm">
        <Text as="span" size="xs" tone="muted" className="block">
          {t('fields.description')}
        </Text>
        <Textarea
          value={description}
          maxLength={1000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <DepartmentBudgets teamId={teamId} department={department} />
      <DepartmentSkills teamId={teamId} department={department} />
      <Inline gap={2} justify="end" wrap>
        <DepartmentTemplateExport teamId={teamId} department={department} />
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate(department.id)}
        >
          {t('actions.delete')}
        </Button>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={update.isPending || !name.trim()}
        >
          {t('actions.save')}
        </Button>
      </Inline>
    </Stack>
  );
}
