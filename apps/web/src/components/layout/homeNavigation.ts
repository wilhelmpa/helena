import {
  accessRootPath,
  agentsPath,
  approvalsPath,
  browserOverviewPath,
  devicesPath,
  globalAgentActivityPath,
  globalInboxPath,
  homeDocsPath,
  homeFilesPath,
  manageTeamsPath,
  teamOrganizationPath,
  mcpsPath,
  pipelinesPath,
  schedulesPath,
  skillsPath,
  tasksPath,
  toolsPath,
} from '@/utils/paths';

export type HomeNavigationId =
  | 'overview'
  | 'allWorkItems'
  | 'inbox'
  | 'files'
  | 'approvals'
  | 'docs'
  | 'agentPool'
  | 'organization'
  | 'agentActivity'
  | 'browser'
  | 'schedules'
  | 'workflows'
  | 'skills'
  | 'tools'
  | 'mcps'
  | 'access'
  | 'devices'
  | 'teamSettings';

// The sidebar group an entry is listed under while no project is selected: the work
// across every project, the team's agents, and the settings every project shares.
export type HomeNavigationGroup = 'work' | 'agents' | 'globalSettings';

export interface HomeNavigationItem {
  id: HomeNavigationId;
  group: HomeNavigationGroup;
  href: string;
}

// The entries that need a single team to point at are left out without one. The
// schedules read across every project, like the tasks, and need none. The workflows are
// the team's library of templates. Home's Docs are the instance owner's own notes. The
// chat is not an entry (owner, 2026-09-24): it lives in the tool panel, full screen from
// there, and /chat stays reachable by link.
export function homeNavigation(teamId: number | null, isOwner = false): HomeNavigationItem[] {
  const teamOnly = (items: HomeNavigationItem[]) => (teamId == null ? [] : items);
  return [
    { id: 'overview', group: 'work', href: '/' },
    { id: 'allWorkItems', group: 'work', href: tasksPath() },
    { id: 'inbox', group: 'work', href: globalInboxPath() },
    { id: 'files', group: 'work', href: homeFilesPath() },
    { id: 'approvals', group: 'work', href: approvalsPath() },
    ...(isOwner ? [{ id: 'docs' as const, group: 'work' as const, href: homeDocsPath() }] : []),
    ...teamOnly([
      { id: 'agentPool', group: 'agents', href: agentsPath() },
      { id: 'organization', group: 'agents', href: teamOrganizationPath() },
    ]),
    { id: 'agentActivity', group: 'agents', href: globalAgentActivityPath() },
    { id: 'browser', group: 'agents', href: browserOverviewPath() },
    { id: 'schedules', group: 'agents', href: schedulesPath() },
    ...teamOnly([
      { id: 'workflows', group: 'agents', href: pipelinesPath() },
      { id: 'skills', group: 'globalSettings', href: skillsPath() },
      { id: 'tools', group: 'globalSettings', href: toolsPath() },
      { id: 'mcps', group: 'globalSettings', href: mcpsPath() },
    ]),
    // "Zugänge & Verbindungen": Google accounts, mailboxes, credentials, the host's
    // connections and the audit log, one area with tabs.
    { id: 'access', group: 'globalSettings', href: accessRootPath() },
    { id: 'devices', group: 'globalSettings', href: devicesPath() },
    { id: 'teamSettings', group: 'globalSettings', href: manageTeamsPath() },
  ];
}
