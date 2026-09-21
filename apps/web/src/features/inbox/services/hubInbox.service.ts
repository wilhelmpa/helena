import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createHubInboxTask,
  listHubInboxSources,
  listHubInboxThreads,
  retryHubInboxTriage,
  updateHubInboxSource,
  updateHubInboxThread,
  type HubInboxFilters,
  type HubInboxPage,
} from '@/lib/api/endpoints/hubInbox';
import { qk } from '@/services/queryKeys';

export function useHubInboxSources(teamId: number) {
  return useQuery({
    queryKey: qk.hubInboxSources(teamId),
    queryFn: () => listHubInboxSources(teamId),
  });
}

export function useHubInboxThreads(teamId: number, filters: HubInboxFilters) {
  return useInfiniteQuery({
    queryKey: qk.hubInboxThreads(teamId, filters),
    queryFn: ({ pageParam }) => listHubInboxThreads(teamId, filters, pageParam),
    initialPageParam: null as HubInboxPage['nextCursor'],
    getNextPageParam: (page) => page.nextCursor,
  });
}

function useInvalidateHubInbox(teamId: number) {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['hubInbox', teamId] });
}

export function useUpdateHubInboxSource(teamId: number) {
  const invalidate = useInvalidateHubInbox(teamId);
  return useMutation({
    mutationFn: ({
      sourceId,
      patch,
    }: {
      sourceId: number;
      patch: Parameters<typeof updateHubInboxSource>[1];
    }) => updateHubInboxSource(sourceId, patch),
    onSuccess: invalidate,
  });
}

export function useUpdateHubInboxThread(teamId: number) {
  const invalidate = useInvalidateHubInbox(teamId);
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof updateHubInboxThread>[1];
    }) => updateHubInboxThread(id, patch),
    onSuccess: invalidate,
  });
}

export function useRetryHubInboxTriage(teamId: number) {
  const invalidate = useInvalidateHubInbox(teamId);
  return useMutation({ mutationFn: retryHubInboxTriage, onSuccess: invalidate });
}

export function useCreateHubInboxTask(teamId: number) {
  const invalidate = useInvalidateHubInbox(teamId);
  return useMutation({ mutationFn: createHubInboxTask, onSuccess: invalidate });
}
