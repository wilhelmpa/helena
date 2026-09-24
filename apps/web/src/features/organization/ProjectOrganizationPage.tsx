'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import OrganizationWorkspace from './components/OrganizationWorkspace';
import { organizationForProject } from './projectOrganization';
import { useOrganizationQuery } from './services/organization.service';

// A project's Team & Orchestrierung: its orchestration, and the team's organization
// narrowed to the project.
export default function ProjectOrganizationPage() {
  const t = useTranslations('organization');
  const { project } = useShell();
  const teamId = project?.project.teamId ?? null;
  const projectKey = project?.project.key ?? null;
  const organization = useOrganizationQuery(teamId, project?.project.id);
  const scopedOrganization = useMemo(
    () =>
      organization.data && projectKey
        ? organizationForProject(organization.data, projectKey)
        : null,
    [organization.data, projectKey],
  );

  if (!project) return null;

  return (
    <SectionPageView title={t('title')} description={t('description')} wide>
      {organization.isPending ? (
        <ListSkeleton rows={6} rowClassName="h-8" />
      ) : organization.isError ? (
        <EmptyState title={t('managerRequiredTitle')} description={t('managerRequired')} />
      ) : scopedOrganization ? (
        <OrganizationWorkspace
          key={`${scopedOrganization.teamId}:${project.project.key}`}
          organization={scopedOrganization}
          projectKey={project.project.key}
        />
      ) : null}
    </SectionPageView>
  );
}
