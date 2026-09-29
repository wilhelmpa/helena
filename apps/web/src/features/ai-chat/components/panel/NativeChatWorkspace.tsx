'use client';

import { useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShellCtx } from '@/context/shellContext';
import type { WorkspaceContentProps } from '@/extensions/panelTools';
import { Box, Text } from '@/design-system';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import ChatWorkspace from '../workspace/ChatWorkspace';
import type { ChatLocation } from '../../utils/chatLocation';
import { chatContextItem, chatPagePath } from '../../utils/chatContext';

// The chat tool of the Werkzeug-Panel: the same ChatWorkspace the full page uses (see
// workspace/ChatWorkspaceRoot), mounted here with its own local location instead of the
// URL — the panel is not the page the address bar names, and it stays mounted across
// tool switches (WorkspacePanel keeps it warm), so its open chat must not reset or
// leak into the page behind it. It lists every agent of the team, the one of the page's
// project first (its coordinator) and Helena right after (owner, 28.09., O41); it sends the
// page, the open task or document with each question and names them above the chat (O50).
export default function NativeChatWorkspace({ projectKey }: WorkspaceContentProps) {
  const t = useTranslations('chatWorkspace');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shell = useContext(ShellCtx);
  const task = shell?.currentIssue ?? null;
  const pagePath = chatPagePath(pathname, searchParams, task);
  const item = chatContextItem(searchParams, task);
  const scope = useChatWorkspaceScope(null, projectKey);
  const [location, setLocation] = useState<ChatLocation>({ agentId: null, threadId: null });
  const place = shell?.project?.project.name ?? projectKey ?? tNav('home');

  // A click elsewhere in the app (an activity entry, an issue) asks to open one of the
  // reader's own conversations. The request is held in Shell until it is handled, so
  // it survives the panel opening a moment later.
  const request = shell?.chatThreadRequest ?? null;
  const handled = shell?.onChatThreadHandled;
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      setLocation({ agentId: request.agentId, threadId: request.threadId });
      handled?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [request, handled]);

  if (scope.loading) {
    return (
      <Box pad={4} className="ds-chat-panel-loading">
        <Skeleton className="ds-chat-list-skeleton" />
      </Box>
    );
  }

  if (!scope.scopeKey) {
    return (
      <Box pad={5}>
        <Text tone="muted">{t('waitingForTeam')}</Text>
      </Box>
    );
  }

  return (
    <div className="ds-chat-panel">
      <div className="helena-home-context" title={pagePath}>
        {tNav('dockContext')} <strong>{place}</strong>
        {item && (
          <>
            {' · '}
            <span className="ds-chat-context-item">
              {item.kind === 'task'
                ? t('context.task', { identifier: item.identifier, title: item.title })
                : t('context.document', { name: item.name })}
            </span>
          </>
        )}
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
