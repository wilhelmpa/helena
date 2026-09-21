import { request } from '@/lib/api/core/client';

export interface ProjectTemplate {
  id: number;
  teamId: number;
  kind: 'project' | 'board';
  name: string;
  description: string;
  createdBy: string | null;
  stateCount: number;
  folderCount: number;
  viewCount: number;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateApplyResult {
  states: number;
  folders: number;
  views: number;
  workflows: number;
  requestedResources: string[];
}

export const listProjectTemplates = (projectKey: string) =>
  request<ProjectTemplate[]>(`/projects/${encodeURIComponent(projectKey)}/project-templates`);

export const captureProjectTemplate = (
  projectKey: string,
  input: { name: string; description?: string; kind: ProjectTemplate['kind'] },
) =>
  request<ProjectTemplate>(`/projects/${encodeURIComponent(projectKey)}/project-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const applyProjectTemplate = (projectKey: string, templateId: number) =>
  request<TemplateApplyResult>(
    `/projects/${encodeURIComponent(projectKey)}/project-templates/${templateId}/apply`,
    {
      method: 'POST',
    },
  );

export const deleteProjectTemplate = (projectKey: string, templateId: number) =>
  request<void>(`/projects/${encodeURIComponent(projectKey)}/project-templates/${templateId}`, {
    method: 'DELETE',
  });
