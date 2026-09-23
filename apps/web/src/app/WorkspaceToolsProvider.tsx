'use client';

import type { ReactNode } from 'react';
import { WorkspaceContentsProvider } from '@/context/workspaceContents';
import InboxWorkspace from '@/features/inbox/InboxWorkspace';
import ConnectionsWorkspace from '@/features/connections/ConnectionsWorkspace';
import MailComposeWorkspace from '@/features/mail/MailComposeWorkspace';
import NativeChatWorkspace from '@/features/ai-chat/components/panel/NativeChatWorkspace';

const contents = {
  chat: NativeChatWorkspace,
  inbox: InboxWorkspace,
  connections: ConnectionsWorkspace,
  mail: MailComposeWorkspace,
};

export default function WorkspaceToolsProvider({ children }: { children: ReactNode }) {
  return <WorkspaceContentsProvider contents={contents}>{children}</WorkspaceContentsProvider>;
}
