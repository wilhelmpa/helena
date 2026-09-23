'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import OrganizationWorkspace from './components/OrganizationWorkspace';
import { organizationForProject } from './projectOrganization';
import { useOrganizationQuery } from './services/organization.service';

export default function ProjectOrganizationPage() {
  const t = useTranslations('organization');
  const { project } = useShell();
  const teamId = project?.project.teamId ?? null;
  const projectKey = project?.project.key ?? null;
  const organization = useOrganizationQuery(teamId);
  const scopedOrganization = useMemo(
    () =>
      organization.data && projectKey
        ? organizationForProject(organization.data, projectKey)
        : null,
    [organization.data, projectKey],
  );

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspacePageHeader title={t('title')} description={t('description')} />
      {organization.isPending ? (
        <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
      ) : organization.isError ? (
        <p className="p-4 text-sm text-muted-foreground">{t('managerRequired')}</p>
      ) : scopedOrganization ? (
        <OrganizationWorkspace
          key={`${scopedOrganization.teamId}:${project.project.key}`}
          organization={scopedOrganization}
          projectKey={project.project.key}
        />
      ) : null}
    </div>
  );
}
