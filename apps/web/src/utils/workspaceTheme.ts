export type WorkspaceThemeService = 'openclaw' | 'code' | 'nextcloud' | 'paperless';
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
  if (tool === 'chat') return 'openclaw';
  if (tool === 'files') return 'nextcloud';
  if (tool === 'paperless') return 'paperless';
  return null;
}
