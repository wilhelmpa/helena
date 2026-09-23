import {
  agentsPath,
  approvalsPath,
  connectionsPath,
  devicesPath,
  globalAgentActivityPath,
  globalInboxPath,
  homeFilesPath,
  manageTeamsPath,
  teamOrganizationPath,
  mcpsPath,
  pipelinesPath,
  schedulesPath,
  skillsPath,
  tasksPath,
  toolsPath,
  credentialsPath,
} from '@/utils/paths';

export type HomeNavigationId =
  | 'overview'
  | 'allWorkItems'
  | 'inbox'
  | 'files'
  | 'approvals'
  | 'agentPool'
  | 'organization'
  | 'agentActivity'
  | 'schedules'
  | 'workflows'
  | 'skills'
  | 'tools'
  | 'mcps'
  | 'connections'
  | 'credentials'
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
// the team's library of templates.
export function homeNavigation(teamId: number | null): HomeNavigationItem[] {
  const teamOnly = (items: HomeNavigationItem[]) => (teamId == null ? [] : items);
  return [
    { id: 'overview', group: 'work', href: '/' },
    { id: 'allWorkItems', group: 'work', href: tasksPath() },
    { id: 'inbox', group: 'work', href: globalInboxPath() },
    { id: 'files', group: 'work', href: homeFilesPath() },
    { id: 'approvals', group: 'work', href: approvalsPath() },
    ...teamOnly([
      { id: 'agentPool', group: 'agents', href: agentsPath() },
      { id: 'organization', group: 'agents', href: teamOrganizationPath() },
    ]),
    { id: 'agentActivity', group: 'agents', href: globalAgentActivityPath() },
    { id: 'schedules', group: 'agents', href: schedulesPath() },
    ...teamOnly([
      { id: 'workflows', group: 'agents', href: pipelinesPath() },
      { id: 'skills', group: 'globalSettings', href: skillsPath() },
      { id: 'tools', group: 'globalSettings', href: toolsPath() },
      { id: 'mcps', group: 'globalSettings', href: mcpsPath() },
    ]),
    { id: 'connections', group: 'globalSettings', href: connectionsPath() },
    ...teamOnly([{ id: 'credentials', group: 'globalSettings', href: credentialsPath() }]),
    { id: 'devices', group: 'globalSettings', href: devicesPath() },
    { id: 'teamSettings', group: 'globalSettings', href: manageTeamsPath() },
  ];
}
