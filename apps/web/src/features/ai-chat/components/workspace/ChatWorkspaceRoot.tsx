'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { chatPath, homeChatPath } from '@/utils/paths';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import { useActiveChat } from '../../hooks/useActiveChat';
import { useChatSummary } from '../../hooks/useChatSummary';
import ChatWorkspace from './ChatWorkspace';
import type { ChatLocation } from '../../utils/chatLocation';

// A URL with a thread wins. A bare URL resumes the saved chat of this scope.
export default function ChatWorkspaceRoot({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('chatWorkspace');
  const router = useRouter();
  const params = useSearchParams();
  const scope = useChatWorkspaceScope(projectKey);
  const {
    location: activeLocation,
    ready: activeReady,
    set: setActive,
    validate,
  } = useActiveChat(projectKey ? `project:${projectKey}` : 'home');
  const handledUrl = useRef<string | null>(null);
  const handledActive = useRef<ChatLocation | null>(null);
  const validatingRoute = useRef<string | null>(null);
  const restoreSequence = useRef(0);

  const agentParam = params.get('agent');
  const threadParam = params.get('thread');
  const location = useMemo<ChatLocation>(
    () => ({ agentId: agentParam ? Number(agentParam) : null, threadId: threadParam }),
    [agentParam, threadParam],
  );

  // A chat lives in the scope it was started in (its project, or Helena's own). One opened
  // from somewhere else — an activity entry, a link — inside another project's chat page would
  // sit beside a list that does not hold it, and the server refuses to remember it as this
  // project's chat: it moves to the page of its own scope instead. Helena's page lists every
  // chat, so only a project page checks.
  // The chats this page opened or created itself are in its scope by construction (and one
  // just created has no record yet to wait for while its answer streams).
  const [ownThreads, setOwnThreads] = useState<ReadonlySet<string>>(new Set());
  const checked =
    projectKey && location.threadId && !ownThreads.has(location.threadId)
      ? location.threadId
      : null;
  const summary = useChatSummary(checked);
  const threadProject = summary.data ? (summary.data.project?.key ?? null) : undefined;
  const foreignThread =
    projectKey != null && threadProject !== undefined && threadProject !== projectKey;
  const resolvingScope = checked != null && (summary.isLoading || foreignThread);
  useEffect(() => {
    const chat = summary.data;
    if (!foreignThread || !chat) return;
    const query = { agent: chat.agent.id, thread: chat.id };
    router.replace(chat.project ? chatPath(chat.project.key, query) : homeChatPath(query), {
      scroll: false,
    });
  }, [foreignThread, summary.data, router]);

  const url = params.toString();
  const routeKey = `${projectKey ?? 'home'}:${url}`;
  const intentionalNew = params.has('new') || (params.has('agent') && !params.has('thread'));
  useEffect(() => {
    if (!activeReady || resolvingScope) return;
    if (handledUrl.current !== routeKey) {
      handledUrl.current = routeKey;
      restoreSequence.current += 1;
      if (location.threadId || intentionalNew) {
        handledActive.current = location;
        setActive(location);
        return;
      }
      validatingRoute.current = routeKey;
      const sequence = restoreSequence.current;
      void validate()
        .then((saved) => {
          if (validatingRoute.current !== routeKey || restoreSequence.current !== sequence) return;
          validatingRoute.current = null;
          if (!saved.threadId && saved.agentId == null) return;
          handledActive.current = saved;
          const query = { agent: saved.agentId, thread: saved.threadId };
          const href = projectKey ? chatPath(projectKey, query) : homeChatPath(query);
          router.replace(saved.threadId ? href : `${href}&new=1`, { scroll: false });
        })
        .catch(() => {
          validatingRoute.current = null;
        });
      return;
    }
    if (validatingRoute.current === routeKey) return;
    const saved = activeLocation;
    if (
      saved.threadId &&
      (saved.threadId !== location.threadId || saved.agentId !== location.agentId) &&
      (handledActive.current?.threadId !== saved.threadId ||
        handledActive.current?.agentId !== saved.agentId)
    ) {
      handledActive.current = saved;
      const query = { agent: saved.agentId, thread: saved.threadId };
      router.replace(projectKey ? chatPath(projectKey, query) : homeChatPath(query), {
        scroll: false,
      });
    }
    if (saved.threadId == null && location.threadId && handledActive.current?.threadId !== null) {
      handledActive.current = saved;
      const href = projectKey ? chatPath(projectKey) : homeChatPath();
      router.replace(`${href}?new=1`, { scroll: false });
    }
  }, [
    activeReady,
    resolvingScope,
    activeLocation,
    routeKey,
    location,
    intentionalNew,
    projectKey,
    router,
    setActive,
    validate,
  ]);

  const onNavigate = useCallback(
    (next: ChatLocation, options?: { replace?: boolean }) => {
      const query = { agent: next.agentId, thread: next.threadId };
      const href = projectKey ? chatPath(projectKey, query) : homeChatPath(query);
      const target = next.threadId ? href : `${href}${href.includes('?') ? '&' : '?'}new=1`;
      restoreSequence.current += 1;
      validatingRoute.current = null;
      handledActive.current = next;
      const opened = next.threadId;
      if (opened) setOwnThreads((current) => new Set(current).add(opened));
      setActive(next);
      if (options?.replace) router.replace(target, { scroll: false });
      else router.push(target, { scroll: false });
    },
    [router, projectKey, setActive],
  );
  const onActivity = useCallback(
    (next: ChatLocation) => {
      if (activeLocation.threadId === next.threadId) setActive(next);
    },
    [activeLocation.threadId, setActive],
  );

  if (scope.loading || resolvingScope || (!activeReady && !location.threadId && !intentionalNew)) {
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
      onActivity={onActivity}
      inPage
    />
  );
}
