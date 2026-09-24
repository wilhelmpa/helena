'use client';

import type { WorkspaceContentProps } from '@/context/workspaceContents';
import ConnectionsContent from './ConnectionsContent';

// The connections in the tool panel: the same list, with its check button in the panel
// rather than in the page's header row.
export default function ConnectionsWorkspace(_props: WorkspaceContentProps) {
  return <ConnectionsContent embedded />;
}
