'use client';

import { useQuery } from '@tanstack/react-query';
import { listFiles, type FileScope } from '@/lib/api/endpoints/projectFiles';

// Folder listings of the Files page, read there and by the pickers that choose a vault
// file elsewhere (relinking a missing attachment).
export const filesScopeKey = (scope: FileScope) =>
  scope.kind === 'project'
    ? (['files', 'project', scope.projectKey, scope.root] as const)
    : (['files', 'home', scope.root] as const);

export function useFilesQuery(scope: FileScope, path: string, enabled = true) {
  return useQuery({
    queryKey: [...filesScopeKey(scope), path],
    queryFn: () => listFiles(scope, path),
    enabled,
    retry: false,
  });
}
