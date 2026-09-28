'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { isAccessTab } from '@/utils/paths';
import type { SettingsLocation } from './settingsModalCatalog';

// The sections of the global settings modal (Mein Konto, Helena, Administrator; see
// docs/einstellungen-struktur.md) as they show inside it: the same components their old
// pages rendered, so nothing is lost.
type Props = { teamId: number; extra?: string };
const page = (load: () => Promise<{ default: ComponentType<never> }>) =>
  dynamic(load as () => Promise<{ default: ComponentType<Props> }>) as ComponentType<Props>;

const account: Record<string, ComponentType<Props>> = {
  profile: page(() => import('@/features/account/AccountProfilePage')),
  preferences: page(() => import('@/features/account/AccountPreferencesPage')),
  notifications: page(() => import('@/features/push/AccountNotificationsPage')),
  accounts: page(() => import('@/features/account/AccountAccountsPage')),
  security: page(() => import('@/features/account/AccountSecurityPage')),
  'api-keys': page(() => import('@/features/api-keys/ApiKeysPage')),
  hotkeys: page(() => import('@/features/god/GodHotkeysPage')),
};

const God = {
  users: page(() => import('@/features/god/GodUsersPage')),
  teams: page(() => import('@/features/god/GodTeamsPage')),
  projects: page(() => import('@/features/god/GodProjectsPage')),
  general: page(() => import('@/features/god/GodGeneralPage')),
  runtime: page(() => import('@/features/god/GodAgentRuntimePage')),
  authentication: page(() => import('@/features/god/GodAuthenticationPage')),
  hotkeys: page(() => import('@/features/god/GodHotkeysPage')),
  security: page(() => import('@/features/god/GodSecurityPage')),
  storage: page(() => import('@/features/god/GodStoragePage')),
  knowledge: page(() => import('@/features/god/GodKnowledgePage')),
  plugins: page(() => import('@/features/god/GodPluginsPage')),
  prices: page(() => import('@/features/god/GodModelPricesPage')),
  localAi: page(() => import('@/features/god/GodLocalAiPage')),
  telegram: page(() => import('@/features/god/GodTelegramPage')),
  email: page(() => import('@/features/god/GodEmailPage')),
  authProvider: page(() => import('@/features/god/GodAuthProviderPage')),
  scim: page(() => import('@/features/god/GodScimPage')),
};
const ServerPage = dynamic(() => import('@/features/server/ServerPage'));
const HomeDefaultsPage = page(() => import('@/features/settings/HomeDefaultsPage'));
const VoicePage = page(() => import('@/features/voice/components/AccountVoicePage'));
const TeamMembers = page(() => import('@/features/teams/components/members/TeamMembersSection'));
const TeamRoles = page(() => import('@/features/teams/components/roles/TeamRolesSection'));
const TeamProjects = page(() => import('@/features/teams/components/projects/TeamProjectsSection'));
const TeamNotifications = page(
  () => import('@/features/teams/components/notifications/TeamNotificationsSection'),
);
const Structure = page(
  () => import('@/features/organization/components/OrganizationStructureSettings'),
);
const Decisions = dynamic(() =>
  import('@/features/decisions/DecisionsPage').then((module) => module.DecisionsContent),
);
const Access = dynamic(() =>
  import('@/features/access/AccessCenterPage').then((module) => module.AccessCenterContent),
);
const Devices = dynamic(() =>
  import('@/features/devices/DevicesPage').then((module) => module.DevicesContent),
);
const UiGallery = dynamic(() => import('@/features/ui-gallery/UiGallery'));
const Organization = dynamic(() => import('./OrganizationSettings'));
const Channels = dynamic(() => import('./ChannelsSettings'));
const Catalog = dynamic(() =>
  import('@/features/home/HomeTeamSectionPage').then((module) => module.HomeTeamSectionContent),
);

// Sections that are several of the old pages together, one after the other.
function Stack({ parts, props }: { parts: ComponentType<Props>[]; props: Props }) {
  return (
    <div className="ds-stack">
      {parts.map((Part, index) => (
        <Part key={index} {...props} />
      ))}
    </div>
  );
}

export default function SettingsAreaContent({
  location,
  teamId,
}: {
  location: SettingsLocation;
  // The team a team section shows when the location names none.
  teamId: number | null;
}) {
  const { area, slug, extra } = location;
  const props: Props = { teamId: Number(extra) || teamId || 0, extra };
  if (area === 'account') {
    const Section = account[slug];
    return Section ? <Section {...props} /> : null;
  }
  switch (slug) {
    case 'organization':
      return <Organization teamId={teamId ?? 0} tab={extra} />;
    case 'channels':
      return <Channels teamId={teamId ?? 0} tab={extra} />;
    case 'defaults':
      return <Stack parts={[HomeDefaultsPage, God.general]} props={props} />;
    case 'agents':
      return <Stack parts={[God.runtime, God.prices]} props={props} />;
    case 'local-ai':
      return <God.localAi {...props} />;
    case 'decisions':
      return <Decisions />;
    case 'skills':
    case 'tools':
    case 'mcps':
      return <Catalog section={slug} />;
    case 'plugins':
      return <God.plugins {...props} />;
    case 'access':
      return <Access tab={extra && isAccessTab(extra) ? extra : 'google'} />;
    case 'devices':
      return <Devices />;
    case 'structure':
      return <Structure {...props} />;
    case 'voice':
      return <VoicePage {...props} />;
    case 'server':
      return <ServerPage tab={extra ?? 'overview'} />;
    case 'server-disks':
    case 'server-backup':
    case 'server-power':
      return <ServerPage tab={slug.slice('server-'.length)} />;
    case 'updates':
      return <ServerPage tab="updates" />;
    case 'team-members':
      return props.teamId ? <TeamMembers {...props} /> : null;
    case 'team-roles':
      return props.teamId ? <TeamRoles {...props} /> : null;
    case 'team-notifications':
      return props.teamId ? <TeamNotifications {...props} /> : null;
    case 'projects':
      return (
        <Stack parts={props.teamId ? [God.projects, TeamProjects] : [God.projects]} props={props} />
      );
    case 'auth-provider':
      return <God.authProvider {...props} />;
    case 'ui':
      return <UiGallery />;
    default: {
      const Section = (God as Record<string, ComponentType<Props>>)[slug];
      return Section ? <Section {...props} /> : null;
    }
  }
}
