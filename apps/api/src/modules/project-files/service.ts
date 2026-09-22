import {
  projectFileDownload,
  projectFilesJson,
  type ProjectFileListDto,
  type ProjectFileTextDto,
} from '#modules/connections/service';

export function projectFilesSlug(projectKey: string): string {
  const key = projectKey.trim().toUpperCase();
  return key === 'VERV' ? 'verve' : key.toLowerCase();
}

export const listProjectFiles = (projectKey: string, path = '') =>
  projectFilesJson<ProjectFileListDto>('/api/files/list', {
    project: projectFilesSlug(projectKey),
    path,
  });

export const readProjectText = (projectKey: string, path: string) =>
  projectFilesJson<ProjectFileTextDto>('/api/files/read-text', {
    project: projectFilesSlug(projectKey),
    path,
  });

export const createProjectText = (projectKey: string, path: string, content: string) =>
  projectFilesJson<{ project: string; path: string; created: true }>('/api/files/create-text', {
    project: projectFilesSlug(projectKey),
    path,
    content,
  });

export const downloadProjectFile = (projectKey: string, path: string) =>
  projectFileDownload({ project: projectFilesSlug(projectKey), path });
