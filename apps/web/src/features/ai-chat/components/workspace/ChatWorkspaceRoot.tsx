'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { chatPath, homeChatPath } from '@/utils/paths';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import ChatWorkspace, { type ChatLocation } from './ChatWorkspace';

// The chat page mounted at /chat (Home, every project) and at
// /project/:projectKey/chat (one project). The open agent and chat stay in the
// address, so a reload or a shared link reopens them — unlike the tool panel's chat
// (panel/NativeChatWorkspace), which keeps the same location in local state instead,
// since it is not the page the address bar is naming.
export default function ChatWorkspaceRoot({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('chatWorkspace');
  const router = useRouter();
  const params = useSearchParams();
  const scope = useChatWorkspaceScope(projectKey);

  const agentParam = params.get('agent');
  const location: ChatLocation = {
    agentId: agentParam ? Number(agentParam) : null,
    threadId: params.get('thread'),
  };

  const onNavigate = useCallback(
    (next: ChatLocation, options?: { replace?: boolean }) => {
      const query = { agent: next.agentId, thread: next.threadId };
      const href = projectKey ? chatPath(projectKey, query) : homeChatPath(query);
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router, projectKey],
  );

  if (scope.loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-full w-full flex-1" />
      </div>
    );
  }

  if (!scope.scopeKey || scope.teamId == null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {projectKey ? null : t('waitingForTeam')}
      </div>
    );
  }

  return (
    <ChatWorkspace
      scopeKey={scope.scopeKey}
      teamId={scope.teamId}
      projectKey={projectKey}
      agents={scope.agents}
      location={location}
      onNavigate={onNavigate}
    />
  );
}
