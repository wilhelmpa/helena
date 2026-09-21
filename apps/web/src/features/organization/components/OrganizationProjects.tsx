'use client';

import { useTranslations } from 'next-intl';
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
    return <p className="text-sm text-muted-foreground">{t('projects.empty')}</p>;
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
