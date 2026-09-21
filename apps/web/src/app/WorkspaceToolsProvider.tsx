'use client';

import type { ReactNode } from 'react';
import { WorkspaceContentsProvider } from '@/context/workspaceContents';
import InboxWorkspace from '@/features/inbox/InboxWorkspace';
import ConnectionsWorkspace from '@/features/connections/ConnectionsWorkspace';
import MailWorkspace from '@/features/connections/MailWorkspace';

const contents = { inbox: InboxWorkspace, connections: ConnectionsWorkspace, mail: MailWorkspace };

export default function WorkspaceToolsProvider({ children }: { children: ReactNode }) {
  return <WorkspaceContentsProvider contents={contents}>{children}</WorkspaceContentsProvider>;
}
