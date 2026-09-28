'use client';

import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Button as ActionButton } from '@/design-system';
import { Input } from '@/components/ui/input';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useCreateDepartment } from '../services/organization.service';
import DepartmentTemplateImportDialog from './DepartmentTemplateImportDialog';
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
  const [importing, setImporting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex max-w-xl min-w-0 flex-1 gap-2"
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
        <ActionButton icon={<FileUp aria-hidden />} onClick={() => setImporting(true)}>
          {t('departments.importTemplate')}
        </ActionButton>
      </div>
      <DepartmentTemplateImportDialog
        teamId={teamId}
        open={importing}
        onOpenChange={setImporting}
      />
      {departments.length === 0 ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('departments.empty')}
        </p>
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
