import { API_URL, apiFailure, request } from '@/lib/api/core/client';

export type ProjectFileRoot = 'vault' | 'code';
export type HomeFileRoot = 'home' | 'private' | 'templates';

// One folder tree the Files page browses: a project's vault folder or workspace, or
// one of the vault's Home, Private and Templates folders.
export type FileScope =
  | { kind: 'project'; projectKey: string; root: ProjectFileRoot }
  | { kind: 'home'; root: HomeFileRoot };

export interface FileItem {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  sizeBytes: number | null;
  contentType: string | null;
  updatedAt: string | null;
}

export interface FileList {
  root: string;
  path: string;
  // The listed folder relative to the vault; null in a workspace.
  vaultPath: string | null;
  // The folder on the server, which VS Code opens.
  absolutePath: string;
  writable: boolean;
  truncated: boolean;
  items: FileItem[];
}

function base(scope: FileScope): string {
  return scope.kind === 'project'
    ? `/projects/${encodeURIComponent(scope.projectKey)}/files`
    : '/files';
}

function url(scope: FileScope, suffix: string, params: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams({ root: scope.root });
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `${base(scope)}${suffix}?${query}`;
}

export const listFiles = (scope: FileScope, path: string) =>
  request<FileList>(url(scope, '', { path }));

export interface FileText {
  path: string;
  content: string;
  sizeBytes: number;
  etag: string;
}
export const readFileText = (scope: FileScope, path: string) =>
  request<FileText>(url(scope, '/text', { path }));
export const saveFileText = (
  scope: FileScope,
  path: string,
  content: string,
  expectedEtag: string,
) =>
  request<FileText>(url(scope, '/text'), {
    method: 'PUT',
    body: JSON.stringify({ path, content, expectedEtag }),
  });

export const createFolder = (scope: FileScope, path: string) =>
  request<{ path: string }>(url(scope, '/folders'), {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const createTextFile = (scope: FileScope, path: string, content: string) =>
  request<{ path: string }>(url(scope, '/text'), {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });

export const moveFile = (scope: FileScope, from: string, to: string) =>
  request<{ path: string }>(url(scope, '/move'), {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });

export const trashFile = (scope: FileScope, path: string) =>
  request<void>(url(scope, '', { path }), { method: 'DELETE' });

// Multipart, so the browser sets the boundary: request() would force a JSON type.
export async function uploadFiles(scope: FileScope, folder: string, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const res = await fetch(`${API_URL}${url(scope, '/upload', { path: folder })}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) throw await apiFailure(res);
  return (await res.json()) as FileItem[];
}

// The file on the web origin (app/protected-media), so a PDF, an image or a video
// opens in the page and a download keeps the session.
export function fileRawUrl(scope: FileScope, path: string, download = false): string {
  const query = new URLSearchParams({ root: scope.root, path });
  if (download) query.set('download', '1');
  const prefix =
    scope.kind === 'project'
      ? `/protected-media/projects/${encodeURIComponent(scope.projectKey)}/files/raw`
      : '/protected-media/files/raw';
  return `${prefix}?${query}`;
}

// The text the vault index extracted from an office file or a scan; null when there is
// none. The only caller of the index for this, so the route changes here alone.
export async function extractedText(vaultPath: string): Promise<string | null> {
  const res = await fetch(
    `${API_URL}/knowledge/documents?${new URLSearchParams({ path: vaultPath })}`,
    {
      credentials: 'include',
      cache: 'no-store',
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: unknown };
  return typeof body.content === 'string' ? body.content : null;
}

export const getFileReferences = (scope: FileScope, path: string) =>
  request<{
    author: string | null;
    runId: number | null;
    links: { kind: string; title: string; href: string }[];
  }>(url(scope, '/references', { path }));
