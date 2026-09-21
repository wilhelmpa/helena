'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useDeleteDepartment, useUpdateDepartment } from '../services/organization.service';

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
    <form
      className="space-y-3 rounded-lg border p-4"
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
          <span className="text-muted-foreground">{t('fields.name')}</span>
          <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('fields.parentDepartment')}</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
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
        <span className="text-muted-foreground">{t('fields.description')}</span>
        <Textarea
          value={description}
          maxLength={1000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(department.id)}
        >
          {t('actions.delete')}
        </Button>
        <Button type="submit" size="sm" disabled={update.isPending || !name.trim()}>
          {t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
