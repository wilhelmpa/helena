import type { FileScope } from '@/lib/api/endpoints/projectFiles';

export function vaultFilePath(scope: FileScope, path: string): string | null {
  if (scope.kind === 'project')
    return scope.root === 'vault' ? `Projects/${scope.projectKey}/${path}` : null;
  const root = scope.root === 'home' ? 'Home' : scope.root === 'private' ? 'Private' : 'Templates';
  return `${root}/${path}`;
}
