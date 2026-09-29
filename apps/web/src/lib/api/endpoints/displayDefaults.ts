import { request } from '@/lib/api/core/client';

// The fields the task views show by default: property keys per layout. Saved by a project
// admin for the whole project, or by a member for every project without one of its own.
export type FieldDefaults = {
  kanban?: string[];
  list?: string[];
  table?: string[];
  calendar?: string[];
};
export interface DisplayDefaults {
  project: FieldDefaults | null;
  global: FieldDefaults | null;
}

export const getDisplayDefaults = (projectKey: string) =>
  request<DisplayDefaults>(`/projects/${projectKey}/display-defaults`);

export const setProjectDisplayDefaults = (projectKey: string, defaults: FieldDefaults | null) =>
  request<DisplayDefaults>(`/projects/${projectKey}/display-defaults`, {
    method: 'PUT',
    body: JSON.stringify({ defaults }),
  });

export const setGlobalDisplayDefaults = (projectKey: string, defaults: FieldDefaults | null) =>
  request<DisplayDefaults>(`/projects/${projectKey}/display-defaults/global`, {
    method: 'PUT',
    body: JSON.stringify({ defaults }),
  });
