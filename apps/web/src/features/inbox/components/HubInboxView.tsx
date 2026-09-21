'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { HubInboxFilters, HubInboxThread } from '@/lib/api/endpoints/hubInbox';
import { useProjectsQuery } from '@/services/projects.service';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { issuePath } from '@/utils/paths';
import HubInboxSources from './HubInboxSources';
import {
  useCreateHubInboxTask,
  useHubInboxSources,
  useHubInboxThreads,
  useRetryHubInboxTriage,
  useUpdateHubInboxThread,
} from '../services/hubInbox.service';

export default function HubInboxView({
  teamId,
  initialProjectId,
}: {
  teamId: number;
  initialProjectId?: number;
}) {
  const t = useTranslations('inbox.hub');
  const [filters, setFilters] = useState<HubInboxFilters>({ projectId: initialProjectId });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sources = useHubInboxSources(teamId);
  const threads = useHubInboxThreads(teamId, filters);
  const projects = useProjectsQuery();
  const update = useUpdateHubInboxThread(teamId);
  const retry = useRetryHubInboxTriage(teamId);
  const createTask = useCreateHubInboxTask(teamId);
  const items = useMemo(
    () => threads.data?.pages.flatMap((page) => page.items) ?? [],
    [threads.data],
  );
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const teamProjects = (projects.data ?? []).filter((item) => item.teamId === teamId);

  useLiveRefresh({
    scope: revScope.hubInbox(teamId),
    targets: [['hubInbox', teamId]],
  });

  const patchFilter = (patch: Partial<HubInboxFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const mutate = (thread: HubInboxThread, patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { id: thread.id, patch },
      { onError: (error) => toast.error(error instanceof Error ? error.message : t('saveFailed')) },
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HubInboxSources teamId={teamId} sources={sources.data ?? []} projects={teamProjects} />
      <div className="flex flex-wrap gap-2 border-b p-3">
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={filters.projectId ?? ''}
          onChange={(event) =>
            patchFilter({ projectId: event.target.value ? Number(event.target.value) : undefined })
          }
        >
          <option value="">{t('allProjects')}</option>
          {teamProjects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.key} · {item.name}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={filters.channel ?? ''}
          onChange={(event) =>
            patchFilter({
              channel: (event.target.value || undefined) as HubInboxFilters['channel'],
            })
          }
        >
          <option value="">{t('allSources')}</option>
          <option value="mail">{t('channel.mail')}</option>
          <option value="whatsapp">{t('channel.whatsapp')}</option>
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={filters.status ?? ''}
          onChange={(event) =>
            patchFilter({ status: (event.target.value || undefined) as HubInboxFilters['status'] })
          }
        >
          <option value="">{t('allStatuses')}</option>
          {(['new', 'assigned', 'waiting', 'done'] as const).map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.needsReview ?? false}
            onChange={(event) => patchFilter({ needsReview: event.target.checked || undefined })}
          />
          {t('needsReview')}
        </label>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          className={`w-full min-w-0 overflow-y-auto border-r md:max-w-sm ${selected ? 'hidden md:block' : ''}`}
        >
          {threads.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
          ) : null}
          {!threads.isLoading && items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
          ) : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`block w-full border-b p-3 text-left hover:bg-muted/50 ${selectedId === item.id ? 'bg-muted' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="truncate font-medium">{item.subject || item.sender}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(item.receivedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{item.sender}</p>
              <p className="mt-1 line-clamp-2 text-sm">{item.snippet}</p>
              <div className="mt-2 flex gap-1">
                <Badge variant="secondary">{t(`channel.${item.channel}`)}</Badge>
                {item.triageStatus === 'needs_review' ? (
                  <Badge variant="destructive">{t('needsReview')}</Badge>
                ) : null}
                {item.issueIdentifier ? (
                  <Badge variant="outline">{item.issueIdentifier}</Badge>
                ) : null}
              </div>
            </button>
          ))}
          {threads.hasNextPage ? (
            <Button
              variant="ghost"
              className="m-3"
              disabled={threads.isFetchingNextPage}
              onClick={() => threads.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          ) : null}
        </div>
        <div
          className={`${selected ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto p-5`}
        >
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t('selectMessage')}</p>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5">
              <Button variant="ghost" className="md:hidden" onClick={() => setSelectedId(null)}>
                {t('back')}
              </Button>
              <div>
                <h2 className="text-lg font-semibold">{selected.subject || selected.sender}</h2>
                <p className="text-sm text-muted-foreground">
                  {selected.sender} · {selected.account}
                </p>
              </div>
              <p className="text-sm whitespace-pre-wrap">{selected.snippet}</p>
              {selected.triageSummary ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                    {t('triage')}
                  </div>
                  <p className="text-sm">{selected.triageSummary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('confidenceValue', { value: Math.round((selected.confidence ?? 0) * 100) })}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  {t('project')}
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={selected.projectId ?? ''}
                    onChange={(event) =>
                      mutate(selected, {
                        projectId: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">{t('unassigned')}</option>
                    {teamProjects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.key} · {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  {t('statusLabel')}
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={selected.status}
                    onChange={(event) =>
                      mutate(selected, { status: event.target.value as HubInboxThread['status'] })
                    }
                  >
                    {(['new', 'assigned', 'waiting', 'done'] as const).map((status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.externalUrl ? (
                  <Button asChild variant="outline">
                    <a href={selected.externalUrl} target="_blank" rel="noreferrer">
                      {t('openSource')}
                    </a>
                  </Button>
                ) : null}
                {selected.issueIdentifier &&
                selected.projectKey &&
                selected.issueSequenceNumber != null ? (
                  <Button asChild variant="outline">
                    <Link href={issuePath(selected.projectKey, selected.issueSequenceNumber)}>
                      {t('openTask', { id: selected.issueIdentifier })}
                    </Link>
                  </Button>
                ) : (
                  <Button
                    disabled={selected.projectId == null || createTask.isPending}
                    onClick={() =>
                      createTask.mutate(selected.id, {
                        onSuccess: () => toast.success(t('taskCreated')),
                        onError: (error) =>
                          toast.error(error instanceof Error ? error.message : t('taskFailed')),
                      })
                    }
                  >
                    {t('createTask')}
                  </Button>
                )}
                {selected.triageStatus === 'failed' || selected.triageStatus === 'needs_review' ? (
                  <Button
                    variant="outline"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(selected.id)}
                  >
                    {t('retryTriage')}
                  </Button>
                ) : null}
              </div>
              {selected.lastTriageError ? (
                <p className="text-sm text-destructive">{selected.lastTriageError}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
