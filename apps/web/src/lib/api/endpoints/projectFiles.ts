import { API_URL, apiFailure, request } from '@/lib/api/core/client';

export interface ProjectFileItem {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  sizeBytes: number | null;
  contentType: string | null;
  updatedAt: string | null;
  previewable: boolean;
}

export interface ProjectFileList {
  project: string;
  path: string;
  items: ProjectFileItem[];
}

export interface ProjectFileText {
  project: string;
  path: string;
  content: string;
  sizeBytes: number;
}

function projectFilesUrl(projectKey: string, suffix = '', path = '') {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const query = params.size ? '?' + params : '';
  return '/projects/' + encodeURIComponent(projectKey) + '/files' + suffix + query;
}

export const listProjectFiles = (projectKey: string, path = '') =>
  request<ProjectFileList>(projectFilesUrl(projectKey, '', path));

export const readProjectText = (projectKey: string, path: string) =>
  request<ProjectFileText>(projectFilesUrl(projectKey, '/text', path));

export const createProjectText = (projectKey: string, input: { path: string; content: string }) =>
  request<{ project: string; path: string; created: true }>(projectFilesUrl(projectKey, '/text'), {
    method: 'POST',
    body: JSON.stringify(input),
  });

export async function downloadProjectFile(projectKey: string, path: string): Promise<void> {
  const response = await fetch(API_URL + projectFilesUrl(projectKey, '/download', path), {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw await apiFailure(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? path.split('/').at(-1) ?? 'download';
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(url);
}
