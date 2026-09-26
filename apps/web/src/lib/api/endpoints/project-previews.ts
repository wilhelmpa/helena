import { request } from '@/lib/api/core/client';

export interface ProjectPreview {
  name: string;
  slug: string;
  status: 'starting' | 'running' | 'stopped' | 'failed';
  url: string;
  port: number;
  cwd: string;
  command: string;
  startedAt: number | null;
  lastActivityAt: number | null;
  idleTimeoutSec: number;
  error?: string;
}
export interface ProjectPreviewStart {
  name?: string;
  cwd?: string;
  command?: string;
  idleTimeoutSec?: number;
}
export interface ProjectPreviewList {
  projectId: number;
  canManage: boolean;
  previews: ProjectPreview[];
}
export interface ProjectPreviewReply {
  preview: ProjectPreview;
  lines?: string[];
}
const path = (key: string) => `/projects/${encodeURIComponent(key)}/previews`;
export const getProjectPreviews = (key: string) => request<ProjectPreviewList>(path(key));
export const startProjectPreview = (key: string, body: ProjectPreviewStart) =>
  request<ProjectPreviewReply>(`${path(key)}/start`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const stopProjectPreview = (key: string, name: string) =>
  request<ProjectPreviewReply>(`${path(key)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const getProjectPreviewLogs = (key: string, name: string) =>
  request<{ preview: ProjectPreview; lines: string[] }>(
    `${path(key)}/logs?name=${encodeURIComponent(name)}&tail=100`,
  );
export const getProjectPreviewUrl = (key: string, name: string) =>
  request<{ name: string; url: string }>(`${path(key)}/url?name=${encodeURIComponent(name)}`);
