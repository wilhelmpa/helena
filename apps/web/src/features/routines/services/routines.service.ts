import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { PageParams } from '@/lib/api/core/paging';
import {
  createRoutine,
  deleteRoutine,
  listMemberRoutines,
  listRoutines,
  runRoutine,
  updateRoutine,
  type RoutineInput,
} from '@/lib/api/endpoints/routines';
import { qk } from '@/services/queryKeys';

export function useRoutines(projectKey: string, params: PageParams) {
  return useQuery({
    queryKey: qk.routinePage(projectKey, params),
    queryFn: () => listRoutines(projectKey, params),
    placeholderData: keepPreviousData,
  });
}

export function useMemberRoutines(params: PageParams) {
  return useQuery({
    queryKey: qk.memberRoutinePage(params),
    queryFn: () => listMemberRoutines(params),
    placeholderData: keepPreviousData,
  });
}

// Every write refreshes both lists: Home shows the same routines as the project.
function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: qk.anyRoutines });
}

export function useCreateRoutine(projectKey: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ idempotencyKey, input }: { idempotencyKey: string; input: RoutineInput }) =>
      createRoutine(projectKey, idempotencyKey, input),
    onSuccess: refresh,
  });
}

export function useUpdateRoutine(projectKey: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      routineId,
      patch,
    }: {
      routineId: string;
      patch: Parameters<typeof updateRoutine>[2];
    }) => updateRoutine(projectKey, routineId, patch),
    onSuccess: refresh,
  });
}

export function useDeleteRoutine(projectKey: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (routineId: string) => deleteRoutine(projectKey, routineId),
    onSuccess: refresh,
  });
}

// A run changes nothing the list shows until it has finished, so it is confirmed.
export function useRunRoutine(projectKey: string) {
  const t = useTranslations('routines');
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (routineId: string) => runRoutine(projectKey, routineId),
    onSuccess: () => {
      toast.success(t('runStarted'));
      void refresh();
    },
  });
}
