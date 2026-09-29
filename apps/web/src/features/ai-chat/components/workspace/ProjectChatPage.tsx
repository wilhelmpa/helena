'use client';

import { useParams } from 'next/navigation';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import ChatWorkspaceRoot from './ChatWorkspaceRoot';
import { Page } from '@/design-system';

// The project's own chat workspace, gated the same way the API routes are: reading
// `ai_agents` of the project.
export default function ProjectChatPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  return (
    <Page variant="bleed">
      <RequirePermission resource="ai_agents" action="read">
        <ChatWorkspaceRoot projectKey={projectKey} />
      </RequirePermission>
    </Page>
  );
}
