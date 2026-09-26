import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProjectPreviews,
  startProjectPreview,
  stopProjectPreview,
  type ProjectPreviewStart,
} from '@/lib/api/endpoints/project-previews';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';

export function useProjectPreviews(projectKey: string) {
  const queryClient = useQueryClient();
  const queryKey = ['project-previews', projectKey];
  const query = useQuery({ queryKey, queryFn: () => getProjectPreviews(projectKey) });
  useLiveRefresh({
    scope: query.data ? revScope.projectPreviews(query.data.projectId) : null,
    targets: [queryKey],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const start = useMutation({
    mutationFn: (body: ProjectPreviewStart) => startProjectPreview(projectKey, body),
    onSettled: refresh,
  });
  const stop = useMutation({
    mutationFn: (name: string) => stopProjectPreview(projectKey, name),
    onSettled: refresh,
  });
  return { query, start, stop };
}
