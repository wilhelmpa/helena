import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGoalOptions } from '@/lib/api/endpoints/projectGoals';
import { qk } from '@/services/queryKeys';
import { compareGoals } from '@/utils/goalMeta';

// The goals a task of the project can serve, with the project's own progress on each. Read
// under work items, so the picker works for a role without the goals pages. `enabled` keeps a
// closed picker from loading them.
export function useGoalOptionsQuery(projectKey: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.goalOptions(projectKey ?? ''),
    queryFn: () => getGoalOptions(projectKey!),
    enabled: projectKey != null && enabled,
    staleTime: 30_000,
  });
}

// The same goals in list order (the ones being worked on first, by title within a status), for
// every place that lists them: the picker, the context menu, the bulk bar.
export function useSortedGoalOptions(projectKey: string | null, enabled = true) {
  const data = useGoalOptionsQuery(projectKey, enabled).data;
  return useMemo(() => [...(data ?? [])].sort(compareGoals), [data]);
}
