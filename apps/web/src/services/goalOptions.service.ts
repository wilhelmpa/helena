import { useQuery } from '@tanstack/react-query';
import { getGoalOptions } from '@/lib/api/endpoints/projectGoals';
import { qk } from '@/services/queryKeys';

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
