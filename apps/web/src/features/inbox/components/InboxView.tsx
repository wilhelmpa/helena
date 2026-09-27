'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Notification } from '@/lib/api/endpoints/notifications';
import { cn } from '@/lib/utils';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBoardIssuesQuery, useProjectQuery } from '@/services/projects.service';
import { useCycleOptionsQuery } from '@/services/cycles.service';
import { useViewFoldersQuery } from '@/services/views.service';
import { useApprovals } from '@/features/approvals/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useAgentActivityFeed } from '@/features/agent-activity/services/agentActivity.service';
import InboxToolbar from './InboxToolbar';
import InboxList from './InboxList';
import InboxDetail from './InboxDetail';
import { useInboxFilters } from '../hooks/useInboxFilters';
import {
  useNotificationsQuery,
  useSetNotificationRead,
  useSnoozeNotification,
  useDeleteNotification,
  useMarkAllRead,
  useDeleteNotifications,
} from '../services/notifications.service';

// The project's notifications: the list beside the task a notification is about. Its
// controls are the page's header row (InboxToolbar), after the page's tabs (`leading`).
export default function InboxView({
  project,
  leading,
}: {
  project: ProjectDetail | null;
  leading?: ReactNode;
}) {
  const t = useTranslations('inbox');
  const projectKey = project?.project.key ?? 'global';
  const projectId = project?.project.id ?? null;

  const { filters, changeFilters } = useInboxFilters(projectKey);
  const [selected, setSelected] = useState<Notification | null>(null);
  const externalKey = project ? null : (selected?.projectKey ?? null);
  const selectedProject = useProjectQuery(externalKey);
  const selectedIssues = useBoardIssuesQuery(externalKey);
  const selectedCycles = useCycleOptionsQuery(
    selectedProject.data?.project.cyclesEnabled ? externalKey : null,
  );
  const selectedAreas = useViewFoldersQuery(externalKey);
  const detailProject: ProjectDetail | null =
    project ??
    (selectedProject.data
      ? {
          ...selectedProject.data,
          issues: selectedIssues.data?.issues ?? [],
          plannedCycles: selectedCycles.data ?? [],
          areas: selectedAreas.data ?? [],
        }
      : null);
  const isMobile = useIsMobile();

  const query = useNotificationsQuery(projectKey, projectId, filters);
  const approvalRequests =
    useApprovals('pending', { page: 1, pageSize: 100 }, project?.project.key).data?.items ?? [];
  const workflowApprovals = (usePipelineApprovals().data ?? []).filter(
    (item) => project == null || item.projectKey === project.project.key,
  );
  const activity = useAgentActivityFeed(project?.project.key ?? null, {});
  const errorActivities = (activity.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (entry) => entry.status === 'failed' || entry.status === 'error',
  );
  const setRead = useSetNotificationRead(projectKey);
  const snooze = useSnoozeNotification(projectKey);
  const deleteOne = useDeleteNotification(projectKey);
  const markAllRead = useMarkAllRead(projectKey, projectId);
  const deleteNotifications = useDeleteNotifications(projectKey, projectId);

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  // The unread count refreshes itself through useInboxUnread; this covers the list.
  useLiveRefresh({
    scope: projectId == null ? null : revScope.inbox(projectId),
    targets: [['notifications', projectKey]],
  });

  const onSelect = (n: Notification) => {
    setSelected(n);
    if (n.readAt == null) setRead.mutate({ id: n.id, read: true });
  };

  const onDelete = (n: Notification) => {
    if (selected?.id === n.id) setSelected(null);
    deleteOne.mutate(n.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <InboxToolbar
        leading={leading}
        filters={filters}
        onFiltersChange={changeFilters}
        onMarkAllRead={() => markAllRead.mutate()}
        onDeleteRead={() => deleteNotifications.mutate('read')}
        onDeleteReadCompleted={() => deleteNotifications.mutate('read-completed')}
      />
      <div
        className={cn(
          'flex w-full min-w-0 flex-col bg-card md:max-w-lg md:border-e',
          selected && 'hidden md:flex',
        )}
      >
        <InboxList
          items={items}
          approvalRequests={approvalRequests}
          workflowApprovals={workflowApprovals}
          errorActivities={errorActivities}
          groupByProject={project == null}
          isLoading={query.isLoading}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onToggleRead={(n, read) => setRead.mutate({ id: n.id, read })}
          onSnooze={(n, until) => snooze.mutate({ id: n.id, until })}
          onDelete={onDelete}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      {selected && detailProject ? (
        <InboxDetail
          key={selected.issueId}
          project={detailProject}
          issueId={selected.issueId}
          issueSeq={selected.issueSeq}
          isMobile={isMobile}
          onBack={() => setSelected(null)}
          onDeleted={() => setSelected(null)}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
          {t('selectNotification')}
        </div>
      )}
    </div>
  );
}
