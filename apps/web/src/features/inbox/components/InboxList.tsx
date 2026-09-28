'use client';

import { Fragment, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Notification } from '@/lib/api/endpoints/notifications';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import type { PipelineApproval } from '@/lib/api/endpoints/pipelines';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { ProjectGroup } from '@/components/helena/ProjectGroup';
import ApprovalRequestCard from '@/features/approvals/components/ApprovalRequestCard';
import PipelineApprovalCard from '@/features/approvals/components/PipelineApprovalCard';
import AgentActivityRow from '@/features/agent-activity/components/AgentActivityRow';
import InboxListItem from './InboxListItem';
import { groupNotifications, NOTIFICATION_GROUP_ORDER } from '../notificationGroups';

// The scrollable notification list. Empty and loading states render in place. New
// pages load automatically when the bottom sentinel scrolls into view; selection
// and paging are owned by the page.
export default function InboxList({
  items,
  approvalRequests,
  workflowApprovals,
  errorActivities,
  groupByProject,
  isLoading,
  selectedId,
  onSelect,
  onToggleRead,
  onSnooze,
  onDelete,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  items: Notification[];
  approvalRequests: ApprovalRequest[];
  workflowApprovals: PipelineApproval[];
  errorActivities: AgentActivityEntry[];
  groupByProject: boolean;
  isLoading: boolean;
  selectedId: number | null;
  onSelect: (n: Notification) => void;
  onToggleRead: (n: Notification, read: boolean) => void;
  onSnooze: (n: Notification, until: string | null) => void;
  onDelete: (n: Notification) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations('inbox');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const grouped = groupNotifications(items, groupByProject);
  const projects = new Map(grouped.map((group) => [group.key, group]));
  for (const approval of [...approvalRequests, ...workflowApprovals]) {
    const key = groupByProject ? approval.projectKey : '';
    if (!projects.has(key))
      projects.set(key, { key, name: approval.projectName, total: 0, groups: [] });
    projects.get(key)!.total++;
  }
  for (const error of errorActivities) {
    const key = groupByProject ? (error.project?.key ?? 'SYS') : '';
    if (!projects.has(key))
      projects.set(key, {
        key,
        name: error.project?.name ?? t('groups.system'),
        total: 0,
        groups: [],
      });
    projects.get(key)!.total++;
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) onLoadMore();
      },
      // Start loading a bit before the sentinel is fully visible.
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  if (isLoading) return <ListSkeleton rows={6} className="p-3" rowClassName="h-16" />;
  if (
    items.length === 0 &&
    approvalRequests.length === 0 &&
    workflowApprovals.length === 0 &&
    errorActivities.length === 0
  ) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {[...projects.values()].map((project) => {
        const projectRequests = approvalRequests.filter(
          (item) => !groupByProject || item.projectKey === project.key,
        );
        const projectWorkflows = workflowApprovals.filter(
          (item) => !groupByProject || item.projectKey === project.key,
        );
        const projectErrors = errorActivities.filter(
          (item) => !groupByProject || (item.project?.key ?? 'SYS') === project.key,
        );
        const content = NOTIFICATION_GROUP_ORDER.map((kind) => {
          const group = project.groups.find((candidate) => candidate.kind === kind);
          const notifications = group?.items ?? [];
          const count =
            notifications.length +
            (kind === 'approvals' ? projectRequests.length + projectWorkflows.length : 0) +
            (kind === 'errors' ? projectErrors.length : 0);
          if (count === 0) return null;
          return (
            <div key={kind}>
              <h3 className="px-4 py-2 font-mono text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                {t(`groups.${kind}`)} · {count}
              </h3>
              {kind === 'approvals' && (
                <div className="space-y-3 px-3 pb-2">
                  {projectRequests.map((request) => (
                    <ApprovalRequestCard key={request.id} request={request} />
                  ))}
                  {projectWorkflows.map((approval) => (
                    <PipelineApprovalCard
                      key={`${approval.runId}:${approval.stepId}:${approval.iteration}`}
                      approval={approval}
                    />
                  ))}
                </div>
              )}
              {kind === 'errors' && (
                <ul>
                  {projectErrors.map((entry) => (
                    <AgentActivityRow key={entry.id} entry={entry} showProject={false} />
                  ))}
                </ul>
              )}
              {notifications.map((n) => (
                <InboxListItem
                  key={n.id}
                  notification={n}
                  selected={n.id === selectedId}
                  onSelect={() => onSelect(n)}
                  onToggleRead={(read) => onToggleRead(n, read)}
                  onSnooze={(until) => onSnooze(n, until)}
                  onDelete={() => onDelete(n)}
                />
              ))}
            </div>
          );
        });
        return groupByProject ? (
          <ProjectGroup
            key={project.key}
            projectKey={project.key}
            projectName={project.name}
            count={project.total}
          >
            {content}
          </ProjectGroup>
        ) : (
          <Fragment key={project.key}>{content}</Fragment>
        );
      })}
      {hasNextPage && <div ref={sentinelRef} className="h-px" />}
      {isFetchingNextPage && <ListSkeleton rows={2} className="p-3" rowClassName="h-16" />}
    </div>
  );
}
