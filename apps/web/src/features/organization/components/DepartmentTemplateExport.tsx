'use client';

import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { downloadBlob } from '@/utils/chartExport';
import { useExportDepartmentTemplate } from '../services/organization.service';

// "Als Vorlage exportieren": the department with its agents, roles, reporting lines,
// heartbeats, routines, goals, skills and budgets as a file, without any credentials.
export default function DepartmentTemplateExport({
  teamId,
  department,
}: {
  teamId: number;
  department: OrganizationDepartment;
}) {
  const t = useTranslations('organization.departments');
  const exportTemplate = useExportDepartmentTemplate(teamId);
  return (
    <Button
      variant="ghost"
      size="small"
      icon={<Download aria-hidden />}
      disabled={exportTemplate.isPending}
      onClick={() =>
        exportTemplate.mutate(department.id, {
          onSuccess: (bundle) => {
            const file = `${bundle.name || 'department'}.helena-department.json`;
            downloadBlob(
              new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }),
              file,
            );
            toast.success(t('exported', { file }));
          },
        })
      }
    >
      {t('exportTemplate')}
    </Button>
  );
}
