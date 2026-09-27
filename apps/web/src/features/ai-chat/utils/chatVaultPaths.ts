import type { FileScope } from '@/lib/api/endpoints/projectFiles';

export function chatUploadScope(scopeKey: string): FileScope {
  return /^team:(\d+)$/.test(scopeKey)
    ? { kind: 'home', root: 'home' }
    : { kind: 'project', projectKey: scopeKey, root: 'vault' };
}

// File listing and upload responses carry paths relative to their selected root.
// Chat attachments instead use vault-relative paths, for both sending and links.
export function chatVaultPath(scopeKey: string, relativePath: string): string {
  const scope = chatUploadScope(scopeKey);
  const root =
    scope.kind === 'project' ? `Projects/${scope.projectKey.trim().toUpperCase()}` : 'Home';
  return `${root}/${relativePath}`;
}
