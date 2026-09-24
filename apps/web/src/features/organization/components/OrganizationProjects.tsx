'use client';

import { useTranslations } from 'next-intl';
import { RowEmpty, RowList } from '@/components/common/page/RowList';
import type { OrganizationDepartment, OrganizationProject } from '@/lib/api/endpoints/organization';
import OrganizationProjectCard from './OrganizationProjectCard';

export default function OrganizationProjects({
  teamId,
  projects,
  departments,
}: {
  teamId: number;
  projects: OrganizationProject[];
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');

  if (projects.length === 0) {
    return (
      <RowList className="bg-card">
        <RowEmpty>{t('projects.empty')}</RowEmpty>
      </RowList>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {projects.map((project) => (
        <OrganizationProjectCard
          key={project.id}
          teamId={teamId}
          project={project}
          departments={departments}
        />
      ))}
    </div>
  );
}
