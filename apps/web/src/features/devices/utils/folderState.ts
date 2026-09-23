export type FolderStateKind = 'idle' | 'scanning' | 'syncing' | 'error' | 'other';

// Syncthing's folder states (scan-waiting, sync-preparing, …) grouped into the few the
// page names. Any other state is shown as Syncthing reports it.
export function folderStateKind(state: string, error: string | null): FolderStateKind {
  if (error || state === 'error') return 'error';
  if (state === 'idle') return 'idle';
  if (state.startsWith('scan')) return 'scanning';
  if (state.startsWith('sync')) return 'syncing';
  return 'other';
}
