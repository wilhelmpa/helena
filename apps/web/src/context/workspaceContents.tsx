'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { WorkspaceToolId } from '@/utils/workspaceTools';

export type WorkspaceContentProps = { projectKey: string | null };
type Contents = Partial<Record<WorkspaceToolId, ComponentType<WorkspaceContentProps>>>;
const WorkspaceContents = createContext<Contents>({});

export function WorkspaceContentsProvider({
  contents,
  children,
}: {
  contents: Contents;
  children: ReactNode;
}) {
  return <WorkspaceContents.Provider value={contents}>{children}</WorkspaceContents.Provider>;
}

export function useWorkspaceContents() {
  return useContext(WorkspaceContents);
}
