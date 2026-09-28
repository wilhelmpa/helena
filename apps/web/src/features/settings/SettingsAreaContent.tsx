'use client';

import dynamic from 'next/dynamic';
import type { SettingsLocation } from './settingsModalCatalog';

// The sections of Home, Mein Konto and Administrator as they show inside the settings
// modal: the same components their old pages rendered, so nothing is lost and no page
// behind the modal has to change.
const account = {
  profile: dynamic(() => import('@/features/account/AccountProfilePage')),
  preferences: dynamic(() => import('@/features/account/AccountPreferencesPage')),
  notifications: dynamic(() => import('@/features/push/AccountNotificationsPage')),
  accounts: dynamic(() => import('@/features/account/AccountAccountsPage')),
  security: dynamic(() => import('@/features/account/AccountSecurityPage')),
  'api-keys': dynamic(() => import('@/features/api-keys/ApiKeysPage')),
  voice: dynamic(() => import('@/features/voice/components/AccountVoicePage')),
};

const admin = {
  users: dynamic(() => import('@/features/god/GodUsersPage')),
  teams: dynamic(() => import('@/features/god/GodTeamsPage')),
  projects: dynamic(() => import('@/features/god/GodProjectsPage')),
  general: dynamic(() => import('@/features/god/GodGeneralPage')),
  'agent-runtime': dynamic(() => import('@/features/god/GodAgentRuntimePage')),
  authentication: dynamic(() => import('@/features/god/GodAuthenticationPage')),
  hotkeys: dynamic(() => import('@/features/god/GodHotkeysPage')),
  security: dynamic(() => import('@/features/god/GodSecurityPage')),
  storage: dynamic(() => import('@/features/god/GodStoragePage')),
  knowledge: dynamic(() => import('@/features/god/GodKnowledgePage')),
  plugins: dynamic(() => import('@/features/god/GodPluginsPage')),
  'model-prices': dynamic(() => import('@/features/god/GodModelPricesPage')),
  'local-ai': dynamic(() => import('@/features/god/GodLocalAiPage')),
  telegram: dynamic(() => import('@/features/god/GodTelegramPage')),
  email: dynamic(() => import('@/features/god/GodEmailPage')),
  'auth-provider': dynamic(() => import('@/features/god/GodAuthProviderPage')),
  scim: dynamic(() => import('@/features/god/GodScimPage')),
};
const ServerPage = dynamic(() => import('@/features/server/ServerPage'));

const team = {
  info: dynamic(() => import('@/features/teams/components/info/TeamInfoSection')),
  projects: dynamic(() => import('@/features/teams/components/projects/TeamProjectsSection')),
  roles: dynamic(() => import('@/features/teams/components/roles/TeamRolesSection')),
  members: dynamic(() => import('@/features/teams/components/members/TeamMembersSection')),
  mcp: dynamic(() => import('@/features/teams/components/mcp/TeamMcpSection')),
  notifications: dynamic(
    () => import('@/features/teams/components/notifications/TeamNotificationsSection'),
  ),
  integrations: dynamic(
    () => import('@/features/teams/components/integrations/TeamIntegrationsSection'),
  ),
  'ai-agents': dynamic(() => import('@/features/teams/components/ai-agents/TeamAiAgentsSection')),
  'agent-skills': dynamic(
    () => import('@/features/teams/components/agent-skills/TeamAgentSkillsSection'),
  ),
  'agent-tools': dynamic(
    () => import('@/features/teams/components/agent-tools/TeamAgentToolsSection'),
  ),
};
const HomeDefaultsPage = dynamic(() => import('@/features/settings/HomeDefaultsPage'));
const ManageTeamsIndex = dynamic(() => import('@/features/teams/ManageTeamsIndex'));
const AgentSettings = dynamic(() => import('./AgentSettingsModalContent'));

export default function SettingsAreaContent({
  location,
  teamId,
}: {
  location: SettingsLocation;
  // The team a Home section shows when the location names none.
  teamId: number | null;
}) {
  const { area, slug, extra } = location;
  if (area === 'account') {
    const Page = account[slug as keyof typeof account];
    return Page ? <Page /> : null;
  }
  if (area === 'admin') {
    if (slug === 'server') return <ServerPage tab={extra ?? 'overview'} />;
    const Page = admin[slug as keyof typeof admin];
    return Page ? <Page /> : null;
  }
  if (area === 'home') {
    // The team list page only forwards to the first team; here that team shows directly.
    if (slug === 'teams') return teamId ? <team.info teamId={teamId} /> : <ManageTeamsIndex />;
    if (slug === 'defaults') return <HomeDefaultsPage />;
    const id = Number(extra) || teamId;
    const Section = team[slug as keyof typeof team];
    return Section && id ? <Section teamId={id} /> : null;
  }
  if (area === 'agent') {
    const agentId = Number(slug);
    return agentId && teamId ? <AgentSettings teamId={teamId} agentId={agentId} /> : null;
  }
  return null;
}
