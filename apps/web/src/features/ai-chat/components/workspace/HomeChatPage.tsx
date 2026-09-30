'use client';

import Shell from '@/components/layout/Shell';
import ChatWorkspaceRoot from './ChatWorkspaceRoot';
import { Page } from '@/design-system';
import { HomeChatWorking } from './HomeChatLanding';

// The Home chat workspace (/chat): wrapped in the same Shell every other Home route
// uses (Files, Agent activity, ...) for its sidebar, header and tool panel — this page
// was mounted bare before, with no shell chrome and no height to fill (see the /chat
// bug report). The header is the standard one of every page: the page's name and, at its right end,
// who is working now. autoOpenGlobalChat is off: this page already is the chat, so the panel
// should not also pop its own chat tool open behind it.
//
// The project-scoped chat (ProjectChatPage) needs no such wrapper: it is routed under
// project/[projectKey]/layout.tsx, which already renders Shell around every project
// page.
export default function HomeChatPage() {
  return (
    <Shell globalHome autoOpenGlobalChat={false}>
      <Page variant="bleed" actions={<HomeChatWorking />}>
        <ChatWorkspaceRoot projectKey={null} />
      </Page>
    </Shell>
  );
}
