import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDisplayDefaults,
  setGlobalDisplayDefaults,
  setProjectDisplayDefaults,
  type DisplayDefaults,
  type FieldDefaults,
} from '@/lib/api/endpoints/displayDefaults';
import { qk } from '@/services/queryKeys';

// The fields a project's task views show by default: the project's own (saved by a project
// admin) and the member's for every project. Read once per project; saving replaces them.
export function useDisplayDefaultsQuery(projectKey: string | null) {
  return useQuery({
    queryKey: qk.displayDefaults(projectKey ?? ''),
    queryFn: () => getDisplayDefaults(projectKey!),
    enabled: projectKey != null,
    staleTime: 60_000,
  });
}

// What a new display starts from: the project's default per layout, else the member's, else
// nothing (the built-in fields). Which one is in force is `source`.
export function effectiveFieldDefaults(data: DisplayDefaults | undefined) {
  const merged: FieldDefaults = { ...(data?.global ?? {}), ...(data?.project ?? {}) };
  const source = (layout: keyof FieldDefaults): 'project' | 'global' | 'builtin' =>
    data?.project?.[layout] ? 'project' : data?.global?.[layout] ? 'global' : 'builtin';
  return { defaults: Object.keys(merged).length ? merged : null, source };
}

export function useSaveDisplayDefaults(projectKey: string) {
  const client = useQueryClient();
  const onSuccess = (data: DisplayDefaults) =>
    client.setQueryData(qk.displayDefaults(projectKey), data);
  return {
    // For everyone in the project; a project admin only.
    saveProject: useMutation({
      mutationFn: (defaults: FieldDefaults | null) =>
        setProjectDisplayDefaults(projectKey, defaults),
      onSuccess,
    }),
    // For the member in every project without one of its own.
    saveGlobal: useMutation({
      mutationFn: (defaults: FieldDefaults | null) =>
        setGlobalDisplayDefaults(projectKey, defaults),
      onSuccess,
    }),
  };
}
