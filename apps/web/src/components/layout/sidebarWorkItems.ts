import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { viewPath } from '@/utils/paths';

export function organizeSidebarViews(views: View[], folders: ViewFolder[]) {
  const sorted = [...views].sort((a, b) => a.position - b.position || a.id - b.id);
  const knownFolders = new Set(folders.map((folder) => folder.id));
  return {
    root: sorted.filter((view) => view.folderId == null || !knownFolders.has(view.folderId)),
    folders: folders.map((folder) => ({
      folder,
      views: sorted.filter((view) => view.folderId === folder.id),
    })),
  };
}

export function activeSidebarView(projectKey: string, pathname: string, views: View[]) {
  return views.find((view) => pathname === viewPath(projectKey, view.id)) ?? null;
}
