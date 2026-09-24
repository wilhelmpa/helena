'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePlugin,
  getPluginUiSlots,
  getPlugins,
  revokePlugin,
  setExternalPlugins,
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
