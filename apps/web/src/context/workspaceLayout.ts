import { createContext, useContext } from 'react';
import type { WorkspaceLayout } from '@/extensions/workspaceLayouts';

// The workspace layout choice for the controls that change it from outside the layout
// host: the header's layout menu and the command palette. Provided by Shell; null
// outside it.
export interface WorkspaceLayoutChoice {
  layouts: WorkspaceLayout[];
  current: string;
  // False on a phone, where one thing shows at a time and there is nothing to choose.
  available: boolean;
  setLayout: (id: string) => void;
  cycle: () => void;
}

export const WorkspaceLayoutCtx = createContext<WorkspaceLayoutChoice | null>(null);

export function useWorkspaceLayoutChoice(): WorkspaceLayoutChoice | null {
  return useContext(WorkspaceLayoutCtx);
}
