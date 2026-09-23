'use client';

import type { ReactNode } from 'react';
import { WorkspaceContentsProvider } from '@/context/workspaceContents';
import InboxWorkspace from '@/features/inbox/InboxWorkspace';
import ConnectionsWorkspace from '@/features/connections/ConnectionsWorkspace';
import MailComposeWorkspace from '@/features/mail/MailComposeWorkspace';
import NativeChatWorkspace from '@/features/ai-chat/components/panel/NativeChatWorkspace';
import TerminalWorkspace from '@/features/owner-terminal/TerminalWorkspace';

const contents = {
  chat: NativeChatWorkspace,
  terminal: TerminalWorkspace,
  inbox: InboxWorkspace,
  connections: ConnectionsWorkspace,
  mail: MailComposeWorkspace,
};

export default function WorkspaceToolsProvider({ children }: { children: ReactNode }) {
  return <WorkspaceContentsProvider contents={contents}>{children}</WorkspaceContentsProvider>;
}
