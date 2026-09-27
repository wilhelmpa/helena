import type { FilterSet } from '@/utils/filters';
import type { SavedViewDisplay } from '@/utils/viewSettings';
import { request } from '@/lib/api/core/client';

// A saved view (a tab above the work items view): a named filter set plus a display
// snapshot (layout + that layout's settings). The view itself is shared by the
// project; only `favorite` is per user. filters/display are stored as jsonb.
export interface View {
  id: number;
  projectId: number;
  folderId: number | null;
  name: string;
  icon: string | null;
  filters: FilterSet;
  display: SavedViewDisplay;
  position: number;
  // Unguessable token for the public read-only share link, or null when not shared.
  shareToken: string | null;
  // Whether the share link exposes the full issues (assignees, labels, custom
  // fields, activity) or only their title, description, state, type, priority,
  // dates, subtasks and links.
  shareExtended: boolean;
  // Whether the current user marked the view as a favorite: it pins the tab to the
  // front and lists the view under Work items in the sidebar.
  favorite: boolean;
  createdAt: string;
}

export interface NewViewInput {
  name: string;
  folderId?: number | null;
  icon?: string | null;
  filters?: FilterSet;
  display?: SavedViewDisplay;
}

export interface ViewPatch {
  name?: string;
  folderId?: number | null;
  icon?: string | null;
  filters?: FilterSet;
  display?: SavedViewDisplay;
}

// An area of the project. `folder` is its directory, relative to the project
// workspace and to the project's folder on the Files page.
export interface ViewFolder {
  id: number;
  projectId: number;
  name: string;
  folder: string;
  position: number;
  createdAt: string;
}

export interface ViewFolderInput {
  name: string;
  folder: string;
}

export const listViews = (projectKey: string, signal?: AbortSignal) =>
  request<View[]>(`/projects/${encodeURIComponent(projectKey)}/views`, { signal });

export const createView = (projectKey: string, input: NewViewInput) =>
  request<View>(`/projects/${projectKey}/views`, { method: 'POST', body: JSON.stringify(input) });

export const updateView = (viewId: number, patch: ViewPatch) =>
  request<View>(`/views/${viewId}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteView = (viewId: number) =>
  request<void>(`/views/${viewId}`, { method: 'DELETE' });

export const setViewFavorite = (viewId: number, favorite: boolean) =>
  request<void>(`/views/${viewId}/favorite`, { method: favorite ? 'PUT' : 'DELETE' });

export const reorderViews = (projectKey: string, folderId: number | null, orderedIds: number[]) =>
  request<View[]>(`/projects/${projectKey}/views/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ folderId, orderedIds }),
  });

export const listViewFolders = (projectKey: string, signal?: AbortSignal) =>
  request<ViewFolder[]>(`/projects/${encodeURIComponent(projectKey)}/view-folders`, { signal });

export const createViewFolder = (projectKey: string, input: ViewFolderInput) =>
  request<ViewFolder>(`/projects/${encodeURIComponent(projectKey)}/view-folders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateViewFolder = (folderId: number, input: ViewFolderInput) =>
  request<ViewFolder>(`/view-folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteViewFolder = (folderId: number) =>
  request<void>(`/view-folders/${folderId}`, { method: 'DELETE' });

export const countViewFolderFiles = (folderId: number) =>
  request<{ count: number }>(`/view-folders/${folderId}/file-count`);

export const reorderViewFolders = (projectKey: string, orderedIds: number[]) =>
  request<ViewFolder[]>(`/projects/${encodeURIComponent(projectKey)}/view-folders/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  });
