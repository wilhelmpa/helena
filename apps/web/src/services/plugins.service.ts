'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePlugin,
  getPluginProjects,
  getPluginUiSlots,
  getPlugins,
  getProjectExtensions,
  revokePlugin,
  setExternalPlugins,
  updateProjectExtension,
  type ExtensionValue,
  type ProjectExtension,
} from '@/lib/api/endpoints/plugins';
import { useSession } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The Administrator's plugin page (owner only) and the UI slots of loaded plugins (every
// signed-in person).

export function usePluginsQuery() {
  return useQuery({ queryKey: qk.plugins, queryFn: getPlugins });
}

export function usePluginDecision() {
  const qc = useQueryClient();
  const done = {
    onSuccess: (data: Awaited<ReturnType<typeof getPlugins>>) => qc.setQueryData(qk.plugins, data),
  };
  return {
    setExternal: useMutation({ mutationFn: setExternalPlugins, ...done }),
    approve: useMutation({ mutationFn: approvePlugin, ...done }),
    revoke: useMutation({ mutationFn: revokePlugin, ...done }),
  };
}

export function usePluginUiSlotsQuery() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.pluginUiSlots,
    queryFn: getPluginUiSlots,
    // The route needs a session; the login and share screens have none.
    enabled: Boolean(session),
    // Plugins load when the API starts, so the list only changes with a restart.
    staleTime: 10 * 60_000,
  });
}

// Helena › Einstellungen › Erweiterungen: the projects each plugin has settings in.
export function usePluginProjectsQuery() {
  return useQuery({ queryKey: qk.pluginProjects, queryFn: getPluginProjects });
}

// Projekt › Einstellungen › Erweiterungen.
export function useProjectExtensionsQuery(projectKey: string) {
  return useQuery({
    queryKey: qk.projectExtensions(projectKey),
    queryFn: () => getProjectExtensions(projectKey),
    retry: false,
  });
}

// Saves some fields of one connection and puts the stored result into the list.
export function useUpdateProjectExtension(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      credentialId,
      values,
    }: {
      credentialId: number;
      values: Record<string, ExtensionValue>;
    }) => updateProjectExtension(projectKey, credentialId, values),
    onSuccess: (connection) =>
      qc.setQueryData<ProjectExtension[]>(qk.projectExtensions(projectKey), (list) =>
        list?.map((extension) => ({
          ...extension,
          connectors: extension.connectors.map((connector) => ({
            ...connector,
            connections: connector.connections.map((entry) =>
              entry.id === connection.id ? connection : entry,
            ),
          })),
        })),
      ),
  });
}
