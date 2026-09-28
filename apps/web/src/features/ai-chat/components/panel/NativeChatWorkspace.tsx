'use client';

import { useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShellCtx } from '@/context/shellContext';
import type { WorkspaceContentProps } from '@/extensions/panelTools';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import ChatWorkspace from '../workspace/ChatWorkspace';
import type { ChatLocation } from '../../utils/chatLocation';

// The chat tool of the Werkzeug-Panel: the same ChatWorkspace the full page uses (see
// workspace/ChatWorkspaceRoot), mounted here with its own local location instead of the
// URL — the panel is not the page the address bar names, and it stays mounted across
// tool switches (WorkspacePanel keeps it warm), so its open chat must not reset or
// leak into the page behind it. Project chats keep their project permission boundary;
// Home uses the member's sole team, so a fresh installation can talk to its global
// master before the first project exists.
export default function NativeChatWorkspace({ projectKey }: WorkspaceContentProps) {
  const t = useTranslations('chatWorkspace');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const contextParams = new URLSearchParams();
  for (const key of ['file', 'path', 'root', 'view']) {
    const value = searchParams.get(key);
    if (value) contextParams.set(key, value);
  }
  const pagePath = `${pathname}${contextParams.size ? `?${contextParams.toString()}` : ''}`;
  const shell = useContext(ShellCtx);
  const scope = useChatWorkspaceScope(null);
  const [location, setLocation] = useState<ChatLocation>({ agentId: null, threadId: null });

  // A click elsewhere in the app (an activity entry, an issue) asks to open one of the
  // reader's own conversations. The request is held in Shell until it is handled, so
  // it survives the panel opening a moment later.
  useEffect(() => {
    if (!shell?.chatThreadRequest) return;
    setLocation({
      agentId: shell.chatThreadRequest.agentId,
      threadId: shell.chatThreadRequest.threadId,
    });
    shell.onChatThreadHandled();
  }, [shell]);

  if (scope.loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-full w-full flex-1" />
      </div>
    );
  }

  if (!scope.scopeKey) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t('waitingForTeam')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="helena-home-context">
        {tNav('dockContext')}{' '}
        <strong>
          {projectKey ?? tNav('home')} › {pathname}
        </strong>
      </div>
      <ChatWorkspace
        scopeKey={scope.scopeKey}
        teamId={scope.teamId}
        projectKey={null}
        agents={scope.agents}
        location={location}
        onNavigate={setLocation}
        pageContext={{ projectKey, path: pagePath }}
      />
    </div>
  );
}
