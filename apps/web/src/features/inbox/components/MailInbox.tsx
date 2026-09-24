'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import type { MailDraftMode, MailThreadFilters } from '@/lib/api/endpoints/mail';
import { useMailAccounts, useStartDraft } from '@/services/mail.service';
import { useProjectsQuery } from '@/services/projects.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import MailFilterBar, { type InboxFilters } from './MailFilterBar';
import MailPageToolbar from './MailPageToolbar';
import MailReadingPane from './MailReadingPane';
import MailThreadList from './MailThreadList';
import ProjectPickerDialog from './ProjectPickerDialog';
import { useMailKeyboard } from '../hooks/useMailKeyboard';
import {
  useMailThread,
  useMailThreads,
  useMoveThread,
  useThreadAction,
} from '../services/mail.service';

// The inbox: every thread the reader reaches, newest first, and the selected one
// beside the list. The project inbox shows the threads filed under the project; Home
// shows all of them with a project filter. The selected thread is in the URL
// (?thread=), so a task or a note links straight to it. On a page (`toolbar`) its
// controls are the page's header row, after the page's own tabs (`leading`); in the
// tool panel they are the inbox's own bar.
export default function MailInbox({
  teamId,
  projectId,
  toolbar = false,
  leading,
}: {
  teamId: number;
  projectId?: number;
  toolbar?: boolean;
  leading?: ReactNode;
}) {
  const t = useTranslations('mail');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = Number(searchParams.get('thread')) || null;
  const [filters, setFilters] = useState<InboxFilters>({
    role: 'inbox',
    unread: false,
    attachments: false,
    scope: 'all',
  });
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const [moving, setMoving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = useMemo<MailThreadFilters>(
    () => ({
      projectId: projectId ?? (typeof filters.scope === 'number' ? filters.scope : undefined),
      home: projectId == null && filters.scope === 'home' ? true : undefined,
      accountId: filters.accountId,
      folderId: filters.folderId,
      role: filters.folderId ? undefined : filters.role,
      unread: filters.unread || undefined,
      attachments: filters.attachments || undefined,
      q: q || undefined,
    }),
    [filters, projectId, q],
  );
  const threads = useMailThreads(teamId, query);
  const rows = useMemo(
    () => threads.data?.pages.flatMap((page) => page.items) ?? [],
    [threads.data],
  );
  const selected = useMailThread(selectedId);
  const accounts = useMailAccounts(teamId);
  const projects = (useProjectsQuery().data ?? []).filter((item) => item.teamId === teamId);
  const action = useThreadAction(teamId);
  const move = useMoveThread();
  const startDraft = useStartDraft(teamId);

  useLiveRefresh({ scope: revScope.mail(teamId), targets: [qk.mail(teamId), ['mail', 'thread']] });

  const select = (threadId: number | null) => {
    const params = new URLSearchParams(searchParams);
    if (threadId == null) params.delete('thread');
    else params.set('thread', String(threadId));
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const index = rows.findIndex((row) => row.id === selectedId);
  const neighbour = () => rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;

  const draft = (mode: MailDraftMode) => {
    if (mode === 'new') {
      const accountId =
        selected.data?.accountId ?? rows[0]?.accountId ?? accounts.data?.[0]?.id ?? undefined;
      if (!accountId) {
        toast.error(t('compose.noAccount'));
        return;
      }
      startDraft.mutate({ mode, accountId });
      return;
    }
    const message = selected.data?.messages.at(-1);
    if (message) startDraft.mutate({ mode, messageId: message.id });
  };

  const archive = () => {
    if (!selectedId) return;
    const next = neighbour();
    action.mutate({ threadId: selectedId, action: 'archive' });
    select(next);
  };

  useMailKeyboard((key) => {
    const current = rows[index];
    switch (key) {
      case 'next':
        if (rows.length > 0) select(rows[Math.min(index + 1, rows.length - 1)]!.id);
        break;
      case 'previous':
        if (rows.length > 0) select(rows[Math.max(index - 1, 0)]!.id);
        break;
      case 'open':
        if (index < 0 && rows[0]) select(rows[0].id);
        break;
      case 'archive':
        archive();
        break;
      case 'reply':
        draft('reply');
        break;
      case 'replyAll':
        draft('reply_all');
        break;
      case 'forward':
        draft('forward');
        break;
      case 'compose':
        draft('new');
        break;
      case 'search':
        searchRef.current?.focus();
        break;
      case 'toggleRead':
        if (current)
          action.mutate({ threadId: current.id, action: current.unread ? 'read' : 'unread' });
        break;
      case 'move':
        if (selectedId) setMoving(true);
        break;
    }
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar ? (
        <MailPageToolbar
          leading={leading}
          teamId={teamId}
          filters={filters}
          onFiltersChange={setFilters}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
          accounts={accounts.data ?? []}
          projects={projectId == null ? projects : null}
          onCompose={() => draft('new')}
        />
      ) : (
        <MailFilterBar
          teamId={teamId}
          filters={filters}
          onFiltersChange={setFilters}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
          accounts={accounts.data ?? []}
          projects={projectId == null ? projects : null}
          onCompose={() => draft('new')}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <MailThreadList
          className={`w-full bg-card md:w-96 md:shrink-0 md:border-e ${selectedId ? 'hidden md:flex' : 'flex'}`}
          rows={rows}
          selectedId={selectedId}
          showProject={projectId == null}
          loading={threads.isPending}
          error={threads.isError}
          hasMore={!!threads.hasNextPage}
          loadingMore={threads.isFetchingNextPage}
          onLoadMore={() => void threads.fetchNextPage()}
          onSelect={select}
        />
        <div className={`min-w-0 flex-1 ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {selectedId ? (
            <MailReadingPane
              key={selectedId}
              teamId={teamId}
              threadId={selectedId}
              onBack={() => select(null)}
              onDraft={draft}
              onArchive={archive}
              onMove={() => setMoving(true)}
              onRemoved={() => select(neighbour())}
            />
          ) : (
            <p className="m-auto p-4 text-sm text-muted-foreground">{t('inbox.nothingSelected')}</p>
          )}
        </div>
      </div>
      {moving && selected.data && (
        <ProjectPickerDialog
          title={t('move.title')}
          description={t('move.description')}
          projects={projects}
          currentProjectId={selected.data.projectId}
          allowHome
          pending={move.isPending}
          onClose={() => setMoving(false)}
          onPick={(target) =>
            move.mutate(
              { threadId: selected.data!.id, projectId: target },
              {
                onSuccess: () => {
                  setMoving(false);
                  toast.success(t('move.done'));
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
