'use client';

import dynamic from 'next/dynamic';
import ProjectSettingsLinksPage from './ProjectSettingsLinksPage';

const pages = {
  agents: dynamic(() => import('./ProjectAgentsExecutionPage')),
  budgets: dynamic(() => import('./SettingsAutopilotPage')),
  mail: dynamic(() => import('./ProjectMailSettingsPage')),
  general: dynamic(() => import('./SettingsGeneralPage')),
  states: dynamic(() => import('./SettingsStatesPage')),
  'issue-types': dynamic(() => import('./SettingsIssueTypesPage')),
  labels: dynamic(() => import('./SettingsLabelsPage')),
  'custom-fields': dynamic(() => import('./SettingsCustomFieldsPage')),
  'issue-templates': dynamic(() => import('./SettingsIssueTemplatesPage')),
  configuration: dynamic(() => import('./SettingsConfigurationPage')),
  actions: dynamic(() => import('./SettingsActionsPage')),
  webhooks: dynamic(() => import('./SettingsWebhooksPage')),
  git: dynamic(() => import('./SettingsGitPage')),
  network: dynamic(() => import('./SettingsNetworkPage')),
  environment: dynamic(() => import('./SettingsEnvironmentPage')),
  browser: dynamic(() => import('./SettingsBrowserGatewayPage')),
  autopilot: dynamic(() => import('./SettingsAutopilotPage')),
  members: dynamic(() => import('@/features/members/MembersPage')),
  notifications: dynamic(() => import('./NotificationPreferencesPage')),
  mcp: dynamic(() => import('@/features/mcp/McpServerPage')),
  'danger-zone': dynamic(() => import('./ProjectDangerSettings')),
};

export default function ProjectSettingsModalContent({ slug }: { slug: string }) {
  if (slug === 'tools' || slug === 'knowledge' || slug === 'integrations') {
    return <ProjectSettingsLinksPage slug={slug} />;
  }
  const Page = pages[slug as keyof typeof pages];
  return Page ? <Page /> : null;
}
