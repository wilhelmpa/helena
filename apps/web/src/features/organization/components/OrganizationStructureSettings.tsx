'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useTeamsQuery } from '@/services/teams.service';
import { useOrganizationQuery } from '../services/organization.service';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationProjects from './OrganizationProjects';

// Helena › Abteilungen (docs/einstellungen-struktur.md): the structure above the
// projects — the departments and which project belongs to which — for the team the
// reader manages. The goals themselves are work and live under Ziele in the sidebar.
export default function OrganizationStructureSettings() {
  const t = useTranslations('organization');
  const teams = useTeamsQuery();
  const team = (teams.data ?? []).find((item) => item.role === 'owner' || item.role === 'manager');
  const organization = useOrganizationQuery(team?.id ?? null);
  if (teams.isPending || (team && organization.isPending))
    return <ListSkeleton rows={4} rowClassName="h-10" />;
  if (!team || !organization.data) return <EmptyState>{t('managerRequired')}</EmptyState>;
  const data = organization.data;
  return (
    <div className="ds-stack">
      <OrganizationDepartments teamId={data.teamId} departments={data.departments} />
      <OrganizationProjects
        teamId={data.teamId}
        projects={data.projects}
        departments={data.departments}
      />
    </div>
  );
}
