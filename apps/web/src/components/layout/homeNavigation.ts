import {
  agentsPath,
  connectionsPath,
  manageTeamsPath,
  mcpsPath,
  skillsPath,
  toolsPath,
  vaultPath,
} from '@/utils/paths';

export type HomeNavigationId =
  'agentPool' | 'connections' | 'vault' | 'mcps' | 'tools' | 'skills' | 'projectSettings';

export function homeNavigation(
  teamId: number | null,
  vaultEnabled = true,
): Array<{
  id: HomeNavigationId;
  href: string;
}> {
  return [
    ...(teamId == null ? [] : [{ id: 'agentPool' as const, href: agentsPath() }]),
    { id: 'connections', href: connectionsPath() },
    ...(vaultEnabled ? [{ id: 'vault' as const, href: vaultPath() }] : []),
    ...(teamId == null
      ? []
      : [
          { id: 'mcps' as const, href: mcpsPath() },
          { id: 'tools' as const, href: toolsPath() },
          { id: 'skills' as const, href: skillsPath() },
        ]),
    { id: 'projectSettings', href: manageTeamsPath() },
  ];
}
