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
    <form
      className="space-y-3 rounded-lg border p-4"
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
        <h3 className="font-medium" dir="auto">
          {project.name}
        </h3>
        <p className="text-xs text-muted-foreground">{project.key}</p>
      </div>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">{t('fields.department')}</span>
        <select
          className="h-9 w-full rounded-md border bg-background px-3"
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
        <span className="text-muted-foreground">{t('fields.projectInstructions')}</span>
        <Textarea
          value={instructions}
          maxLength={4000}
          placeholder={t('projects.instructionsPlaceholder')}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate(project.id)}
        >
          {t('actions.clearAssignment')}
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
