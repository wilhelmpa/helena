import { useContext } from 'react';
import type { WorkspaceLayout } from '@/extensions/workspaceLayouts';
import { ShellCtx } from './shellContext';

// The workspace layout choice for the controls that change it from outside the layout
// host: the header's layout menu and the command palette. Shell hands it over in its
// context; null outside the Shell.
export interface WorkspaceLayoutChoice {
  layouts: WorkspaceLayout[];
  current: string;
  // False on a phone, where one thing shows at a time and there is nothing to choose.
  available: boolean;
  setLayout: (id: string) => void;
  cycle: () => void;
}

export function useWorkspaceLayoutChoice(): WorkspaceLayoutChoice | null {
  return useContext(ShellCtx)?.workspaceLayout ?? null;
}
