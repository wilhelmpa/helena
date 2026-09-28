'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Page, PageTabs, PageToolbarSpacer } from '@/design-system';
import { helenaSettingsPath } from './settingsModalCatalog';

// Helena › Einstellungen › Organisation (owner, O32/O33/O34): who works here and how it is
// structured, one page instead of six — Menschen (the team's people and invites, agents
// live in Team), Konten (every account of the installation), Teams, Rollen, Projekte and
// Abteilungen. Each tab is the page it used to be; old addresses land on their tab.
const TeamMembers = dynamic(() => import('@/features/teams/components/members/TeamMembersSection'));
const GodUsers = dynamic(() => import('@/features/god/GodUsersPage'));
const GodTeams = dynamic(() => import('@/features/god/GodTeamsPage'));
const TeamRoles = dynamic(() => import('@/features/teams/components/roles/TeamRolesSection'));
const GodProjects = dynamic(() => import('@/features/god/GodProjectsPage'));
const Structure = dynamic(
  () => import('@/features/organization/components/OrganizationStructureSettings'),
);

export const ORGANIZATION_TABS = [
  'people',
  'accounts',
  'teams',
  'roles',
  'projects',
  'departments',
] as const;
export type OrganizationTab = (typeof ORGANIZATION_TABS)[number];

export function isOrganizationTab(value: string | undefined): value is OrganizationTab {
  return ORGANIZATION_TABS.includes(value as OrganizationTab);
}

export default function OrganizationSettings({ teamId, tab }: { teamId: number; tab?: string }) {
  const t = useTranslations('settings.organization');
  const current: OrganizationTab = isOrganizationTab(tab) ? tab : 'people';
  return (
    <Page
      toolbar={
        <>
          <PageTabs<OrganizationTab>
            label={t('label')}
            value={current}
            items={ORGANIZATION_TABS.map((value) => ({
              value,
              label: t(`tabs.${value}`),
              href: helenaSettingsPath('organization', value),
            }))}
          />
          <PageToolbarSpacer />
        </>
      }
    >
      {current === 'people' && teamId > 0 && <TeamMembers teamId={teamId} humansOnly />}
      {current === 'accounts' && <GodUsers />}
      {current === 'teams' && <GodTeams />}
      {current === 'roles' && teamId > 0 && <TeamRoles teamId={teamId} />}
      {current === 'projects' && <GodProjects />}
      {current === 'departments' && <Structure />}
    </Page>
  );
}
