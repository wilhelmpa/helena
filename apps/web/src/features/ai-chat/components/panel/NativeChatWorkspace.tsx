'use client';

import { useContext, useEffect, useState } from 'react';
import { ShellCtx } from '@/context/shellContext';
import type { WorkspaceContentProps } from '@/context/workspaceContents';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { nativeChatProjectKey } from '@/utils/workspaceTools';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import ChatWorkspace, { type ChatLocation } from '../workspace/ChatWorkspace';

// The chat tool of the Werkzeug-Panel: the same ChatWorkspace the full page uses (see
// workspace/ChatWorkspaceRoot), mounted here with its own local location instead of the
// URL — the panel is not the page the address bar names, and it stays mounted across
// tool switches (WorkspacePanel keeps it warm), so its open chat must not reset or
// leak into the page behind it. Project chats keep their project permission boundary;
// Home uses the member's sole team, so a fresh installation can talk to its global
// master before the first project exists.
export default function NativeChatWorkspace({ projectKey }: WorkspaceContentProps) {
  const config = runtimeEnv().workspace;
  const shell = useContext(ShellCtx);
  const chatProjectKey = projectKey ? nativeChatProjectKey(config, projectKey) : null;
  const scope = useChatWorkspaceScope(chatProjectKey);
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
        Home chat is waiting for the first account.
      </div>
    );
  }

  return (
    <ChatWorkspace
      scopeKey={scope.scopeKey}
      teamId={scope.teamId}
      projectKey={chatProjectKey}
      agents={scope.agents}
      location={location}
      onNavigate={setLocation}
    />
  );
}
