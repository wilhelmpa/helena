'use client';

import { FolderKanban } from 'lucide-react';

import { useTranslations } from 'next-intl';
import type { OrganizationDepartment, OrganizationProject } from '@/lib/api/endpoints/organization';
import OrganizationProjectCard from './OrganizationProjectCard';
import { EmptyState, List, Section } from '@/design-system';

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
      <EmptyState icon={<FolderKanban />} fill={false}>
        {t('projects.empty')}
      </EmptyState>
    );
  }

  return (
    <Section title={t('projects.title')}>
      <List label={t('projects.title')}>
        {projects.map((project) => (
          <OrganizationProjectCard
            key={project.id}
            teamId={teamId}
            project={project}
            departments={departments}
          />
        ))}
      </List>
    </Section>
  );
}
