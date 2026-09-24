'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RowEmpty, RowList } from '@/components/common/page/RowList';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useCreateDepartment } from '../services/organization.service';
import OrganizationDepartmentCard from './OrganizationDepartmentCard';

export default function OrganizationDepartments({
  teamId,
  departments,
}: {
  teamId: number;
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');
  const create = useCreateDepartment(teamId);
  const [name, setName] = useState('');

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { name },
            {
              onSuccess: () => setName(''),
            },
          );
        }}
      >
        <Input
          value={name}
          maxLength={80}
          placeholder={t('departments.newPlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending || !name.trim()}>
          {t('actions.add')}
        </Button>
      </form>
      {departments.length === 0 ? (
        <RowList className="bg-card">
          <RowEmpty>{t('departments.empty')}</RowEmpty>
        </RowList>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {departments.map((department) => (
            <OrganizationDepartmentCard
              key={department.id}
              teamId={teamId}
              department={department}
              departments={departments}
            />
          ))}
        </div>
      )}
    </div>
  );
}
