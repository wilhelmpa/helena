'use client';

import { useParams } from 'next/navigation';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import ChatWorkspaceRoot from './ChatWorkspaceRoot';

// The project's own chat workspace, gated the same way the API routes are: reading
// `ai_agents` of the project.
export default function ProjectChatPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  return (
    <RequirePermission resource="ai_agents" action="read">
      <ChatWorkspaceRoot projectKey={projectKey} />
    </RequirePermission>
  );
}
