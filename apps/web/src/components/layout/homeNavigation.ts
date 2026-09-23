import {
  agentsPath,
  approvalsPath,
  connectionsPath,
  devicesPath,
  globalAgentActivityPath,
  globalInboxPath,
  homeDocsPath,
  homeFilesPath,
  manageTeamsPath,
  teamOrganizationPath,
  mcpsPath,
  schedulesPath,
  skillsPath,
  tasksPath,
  toolsPath,
  vaultPath,
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
  | 'schedules'
  | 'skills'
  | 'tools'
  | 'mcps'
  | 'connections'
  | 'vault'
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
// schedules read across every project, like the tasks, and need none. Home's Docs are
// the instance owner's own notes.
export function homeNavigation(
  teamId: number | null,
  vaultEnabled = true,
  isOwner = false,
): HomeNavigationItem[] {
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
    { id: 'schedules', group: 'agents', href: schedulesPath() },
    ...teamOnly([
      { id: 'skills', group: 'globalSettings', href: skillsPath() },
      { id: 'tools', group: 'globalSettings', href: toolsPath() },
      { id: 'mcps', group: 'globalSettings', href: mcpsPath() },
    ]),
    { id: 'connections', group: 'globalSettings', href: connectionsPath() },
    ...(vaultEnabled
      ? [{ id: 'vault' as const, group: 'globalSettings' as const, href: vaultPath() }]
      : []),
    { id: 'devices', group: 'globalSettings', href: devicesPath() },
    { id: 'teamSettings', group: 'globalSettings', href: manageTeamsPath() },
  ];
}
