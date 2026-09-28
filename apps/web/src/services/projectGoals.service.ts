import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProjectGoalContext,
  getProjectWhyChains,
  setProjectPoolGoal,
} from '@/lib/api/endpoints/projectGoals';
const key = (projectKey: string) => ['project-goal-context', projectKey] as const;
export function useProjectGoalContext(projectKey: string) {
  return useQuery({
    queryKey: key(projectKey),
    queryFn: () => getProjectGoalContext(projectKey),
    refetchInterval: 15000,
  });
}

export function useProjectWhyChains(projectKey: string | null) {
  return useQuery({
    queryKey: ['project-why-chains', projectKey],
    queryFn: () => getProjectWhyChains(projectKey!),
    enabled: projectKey != null,
    refetchInterval: 15000,
  });
}
// The why chains of several projects at once (Helena's Team page, over every project).
export function useProjectsWhyChains(projectKeys: string[]) {
  return useQueries({
    queries: projectKeys.map((projectKey) => ({
      queryKey: ['project-why-chains', projectKey],
      queryFn: () => getProjectWhyChains(projectKey),
      refetchInterval: 15000,
    })),
  });
}
export function useSetProjectPoolGoal(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ initiativeId, goalId }: { initiativeId: number; goalId: number | null }) =>
      setProjectPoolGoal(initiativeId, goalId),
    onSuccess: () => client.invalidateQueries({ queryKey: key(projectKey) }),
  });
}
