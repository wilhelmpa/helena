export type WorkspaceThemeService = 'agent_runtime' | 'code' | 'nextcloud';
export type WorkspaceTheme = 'light' | 'dark';

export const WORKSPACE_THEME_SYNCED_EVENT = 'volition:workspace-theme-synced';

export function notifyWorkspaceThemeSynced(
  theme: WorkspaceTheme,
  services: WorkspaceThemeService[],
) {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_THEME_SYNCED_EVENT, {
      detail: { theme, services: [...new Set(services)] },
    }),
  );
}

export function themeServiceForTool(tool: string): WorkspaceThemeService | null {
  if (tool === 'files') return 'nextcloud';
  return null;
}
