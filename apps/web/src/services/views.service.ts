import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type View,
  listViews,
  createView,
  updateView,
  deleteView,
  setViewFavorite,
  reorderViews,
  type ViewFolder,
  listViewFolders,
  createViewFolder,
  updateViewFolder,
  deleteViewFolder,
  reorderViewFolders,
} from '@/lib/api/endpoints/views';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { normalizeSavedDisplay } from '@/utils/viewSettings';
import { useOptimisticReorder } from '@/services/optimisticReorder';
import { qk } from '@/services/queryKeys';

// Coerces a view's jsonb blobs (opaque on the server) into the client shapes,
// filling defaults for a missing/partial display or filter set. Applied by the
// views query and after a create/update so consumers always get client shapes.
export function normalizeView(v: View): View {
  const conditions = (v.filters as FilterSet | undefined)?.conditions;
  return {
    ...v,
    filters: Array.isArray(conditions) ? { conditions } : EMPTY_FILTER_SET,
    display: normalizeSavedDisplay(v.display),
  };
}

export function useViewsQuery(projectKey: string | null) {
  return useQuery({
    queryKey: qk.views(projectKey ?? ''),
    queryFn: () => listViews(projectKey!),
    enabled: projectKey != null,
    // The caller's favorites are pinned to the front of the tab row; the rest keep
    // their stored order.
    select: (rows) =>
      rows.map(normalizeView).sort((a, b) => Number(b.favorite) - Number(a.favorite)),
  });
}

export function useCreateView(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof createView>[1] }) =>
      createView(projectKey!, input),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    },
  });
}

export function useUpdateView(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Parameters<typeof updateView>[1] }) =>
      updateView(id, input),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    },
  });
}

export function useDeleteView(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteView(id),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    },
  });
}

export function useSetViewFavorite(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) =>
      setViewFavorite(id, favorite),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    },
  });
}

export function useReorderViews(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, orderedIds }: { folderId: number | null; orderedIds: number[] }) =>
      reorderViews(projectKey!, folderId, orderedIds),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    },
  });
}

export function useViewFoldersQuery(projectKey: string | null) {
  return useQuery({
    queryKey: qk.viewFolders(projectKey ?? ''),
    queryFn: () => listViewFolders(projectKey!),
    enabled: projectKey != null,
  });
}

export function useCreateViewFolder(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createViewFolder(projectKey!, name),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.viewFolders(projectKey) });
    },
  });
}

export function useUpdateViewFolder(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateViewFolder(id, name),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.viewFolders(projectKey) });
    },
  });
}

export function useDeleteViewFolder(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteViewFolder(id),
    // The area's issues lose it in the database, so the board reloads them too.
    onSuccess: () => {
      if (!projectKey) return;
      void qc.invalidateQueries({ queryKey: qk.viewFolders(projectKey) });
      void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
      void qc.invalidateQueries({ queryKey: qk.boardIssues(projectKey) });
    },
  });
}

export function useReorderViewFolders(projectKey: string | null) {
  return useOptimisticReorder<ViewFolder>(
    projectKey ? qk.viewFolders(projectKey) : null,
    (orderedIds) => reorderViewFolders(projectKey!, orderedIds),
  );
}
