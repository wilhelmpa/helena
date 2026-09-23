import {
  agentsPath,
  approvalsPath,
  connectionsPath,
  globalAgentActivityPath,
  globalInboxPath,
  manageTeamsPath,
  teamOrganizationPath,
  mcpsPath,
  skillsPath,
  tasksPath,
  toolsPath,
  vaultPath,
} from '@/utils/paths';

export type HomeNavigationId =
  | 'overview'
  | 'allWorkItems'
  | 'inbox'
  | 'approvals'
  | 'agentPool'
  | 'organization'
  | 'agentActivity'
  | 'skills'
  | 'tools'
  | 'mcps'
  | 'connections'
  | 'vault'
  | 'teamSettings';

// The sidebar group an entry is listed under while no project is selected: the work
// across every project, the team's agents, and the settings every project shares.
export type HomeNavigationGroup = 'work' | 'agents' | 'globalSettings';

export interface HomeNavigationItem {
  id: HomeNavigationId;
  group: HomeNavigationGroup;
  href: string;
}

// The entries that need a single team to point at are left out without one.
export function homeNavigation(teamId: number | null, vaultEnabled = true): HomeNavigationItem[] {
  const teamOnly = (items: HomeNavigationItem[]) => (teamId == null ? [] : items);
  return [
    { id: 'overview', group: 'work', href: '/' },
    { id: 'allWorkItems', group: 'work', href: tasksPath() },
    { id: 'inbox', group: 'work', href: globalInboxPath() },
    { id: 'approvals', group: 'work', href: approvalsPath() },
    ...teamOnly([
      { id: 'agentPool', group: 'agents', href: agentsPath() },
      { id: 'organization', group: 'agents', href: teamOrganizationPath() },
    ]),
    { id: 'agentActivity', group: 'agents', href: globalAgentActivityPath() },
    ...teamOnly([
      { id: 'skills', group: 'globalSettings', href: skillsPath() },
      { id: 'tools', group: 'globalSettings', href: toolsPath() },
      { id: 'mcps', group: 'globalSettings', href: mcpsPath() },
    ]),
    { id: 'connections', group: 'globalSettings', href: connectionsPath() },
    ...(vaultEnabled
      ? [{ id: 'vault' as const, group: 'globalSettings' as const, href: vaultPath() }]
      : []),
    { id: 'teamSettings', group: 'globalSettings', href: manageTeamsPath() },
  ];
}
