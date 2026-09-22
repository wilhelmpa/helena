import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createProjectText,
  listProjectFiles,
  readProjectText,
} from '@/lib/api/endpoints/projectFiles';

const keys = {
  root: (projectKey: string) => ['projectFiles', projectKey] as const,
  list: (projectKey: string, path: string) => ['projectFiles', projectKey, 'list', path] as const,
  text: (projectKey: string, path: string) => ['projectFiles', projectKey, 'text', path] as const,
};

export function useProjectFilesQuery(projectKey: string, path: string) {
  return useQuery({
    queryKey: keys.list(projectKey, path),
    queryFn: () => listProjectFiles(projectKey, path),
  });
}

export function useProjectTextQuery(projectKey: string, path: string | null) {
  return useQuery({
    queryKey: keys.text(projectKey, path ?? ''),
    queryFn: () => readProjectText(projectKey, path!),
    enabled: path != null,
  });
}

export function useCreateProjectText(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; content: string }) => createProjectText(projectKey, input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.root(projectKey) }),
  });
}
