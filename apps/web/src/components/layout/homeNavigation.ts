import {
  agentsPath,
  connectionsPath,
  manageTeamsPath,
  teamOrganizationPath,
  mcpsPath,
  skillsPath,
  toolsPath,
  vaultPath,
} from '@/utils/paths';

export type HomeNavigationId =
  | 'agentPool'
  | 'organization'
  | 'connections'
  | 'vault'
  | 'mcps'
  | 'tools'
  | 'skills'
  | 'teamSettings';

export function homeNavigation(
  teamId: number | null,
  vaultEnabled = true,
): Array<{
  id: HomeNavigationId;
  href: string;
}> {
  return [
    ...(teamId == null
      ? []
      : [
          { id: 'agentPool' as const, href: agentsPath() },
          { id: 'organization' as const, href: teamOrganizationPath() },
        ]),
    { id: 'connections', href: connectionsPath() },
    ...(vaultEnabled ? [{ id: 'vault' as const, href: vaultPath() }] : []),
    ...(teamId == null
      ? []
      : [
          { id: 'mcps' as const, href: mcpsPath() },
          { id: 'tools' as const, href: toolsPath() },
          { id: 'skills' as const, href: skillsPath() },
        ]),
    { id: 'teamSettings', href: manageTeamsPath() },
  ];
}
