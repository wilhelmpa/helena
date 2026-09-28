'use client';

import '@/extensions/homeWidgets';
import { useEffect } from 'react';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { listApprovals } from '@/lib/api/endpoints/approvals';
import { nextPageParam } from '@/lib/api/core/paging';
import { listNotifications, type Notification } from '@/lib/api/endpoints/notifications';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useProposals } from '@/features/agent-runtime/services/agentRuntime.service';
import { useProjectsQuery } from '@/services/projects.service';
import { useHomeActiveActivity } from '@/features/home/services/homeKpis.service';
import { useIsOwner } from '@/features/home/dashboard/useHomeDashboard';
import { useNeedsYou } from '@/features/home/dashboard/useNeedsYou';
import { ownerInboxItems } from './ownerInboxItems';

async function unreadMentions(projectId: number): Promise<Notification[]> {
  const items: Notification[] = [];
  let cursor = null;
  do {
    const page = await listNotifications(projectId, {
      cursor,
      limit: 100,
      filters: { types: ['mentioned'], includeRead: false },
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export function useOwnerInbox() {
  const owner = useIsOwner();
  const projects = useProjectsQuery();
  const approvals = useInfiniteQuery({
    queryKey: ['approvals', 'list', 'owner-inbox'],
    queryFn: ({ pageParam }) => listApprovals({ page: pageParam, pageSize: 100 }, 'pending'),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
  useEffect(() => {
    if (approvals.hasNextPage && !approvals.isFetchingNextPage) void approvals.fetchNextPage();
  }, [approvals.hasNextPage, approvals.isFetchingNextPage, approvals.fetchNextPage]);
  const steps = usePipelineApprovals();
  const proposals = useProposals('pending');
  const needs = useNeedsYou(new Set(), owner);
  const activity = useHomeActiveActivity();
  const mentions = useQueries({
    queries: (projects.data ?? []).map((project) => ({
      queryKey: ['notifications', project.key, 'owner-inbox-mentions'],
      queryFn: () => unreadMentions(project.id),
      staleTime: 30_000,
      refetchInterval: 30_000,
    })),
  });
  const data = ownerInboxItems({
    approvals: approvals.data?.pages.flatMap((page) => page.items) ?? [],
    steps: steps.data ?? [],
    proposals: proposals.data ?? [],
    mentions: mentions.flatMap((query) => query.data ?? []),
    needs: needs.items,
    activity: activity.data?.items ?? [],
  });
  return {
    ...data,
    loading:
      approvals.isPending ||
      approvals.hasNextPage ||
      steps.isPending ||
      proposals.isPending ||
      projects.isPending ||
      needs.isPending ||
      mentions.some((query) => query.isPending),
    error:
      approvals.isError ||
      steps.isError ||
      proposals.isError ||
      projects.isError ||
      activity.isError ||
      mentions.some((query) => query.isError),
    projects: projects.data ?? [],
  };
}
