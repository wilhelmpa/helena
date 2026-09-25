'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useSyncExternalStore } from 'react';
import {
  getPushOverview,
  removePushDevice,
  subscribePushDevice,
  testPushDevice,
  updatePushDevice,
  type PushOverview,
} from '@/lib/api/endpoints/push';
import { qk } from '@/services/queryKeys';
import { deviceLabel } from '../utils/deviceLabel';
import { pushSupport, type PushSupport } from '../utils/pushSupport';
import {
  localSubscription,
  pushEnvironmentStore,
  subscribeBrowser,
  unsubscribeBrowser,
} from './pushBrowser';

// Reading and changing push for the signed-in person: the key, the categories and their
// devices from the API; this browser's own subscription from the service worker.

const LOCAL_KEY = [...qk.push, 'local'] as const;

export function usePushOverview(enabled = true) {
  return useQuery({
    queryKey: qk.push,
    queryFn: getPushOverview,
    enabled,
    staleTime: 60_000,
  });
}

// What this browser can do (null while rendering on the server).
export function usePushSupport(): PushSupport | null {
  const env = useSyncExternalStore(
    pushEnvironmentStore.subscribe,
    pushEnvironmentStore.get,
    pushEnvironmentStore.getServer,
  );
  return env ? pushSupport(env) : null;
}

// This browser's subscription, if it has one.
export function useLocalPushSubscription(enabled: boolean) {
  return useQuery({
    queryKey: LOCAL_KEY,
    queryFn: async () => {
      const local = await localSubscription();
      return local ? { endpoint: local.endpoint, key: local.key } : null;
    },
    enabled,
    staleTime: Infinity,
  });
}

// The device of the list that is this browser.
export function thisDevice(
  overview: PushOverview | undefined,
  endpoint: string | null | undefined,
) {
  if (!overview || !endpoint) return undefined;
  return overview.devices.find((device) => device.endpoint === endpoint);
}

export function usePushMutations() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const refresh = async () => {
    pushEnvironmentStore.refresh();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.push }),
      queryClient.invalidateQueries({ queryKey: LOCAL_KEY }),
    ]);
  };

  const enable = useMutation({
    mutationFn: async ({ publicKey, replaces }: { publicKey: string; replaces?: string }) => {
      const subscription = await subscribeBrowser(publicKey);
      return subscribePushDevice({
        subscription: subscription.toJSON(),
        vapidKey: publicKey,
        label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0),
        locale,
        ...(replaces ? { replaces } : {}),
      });
    },
    // The page words a refused permission itself.
    meta: { suppressErrorToast: true },
    onSettled: refresh,
  });

  const disable = useMutation({
    mutationFn: async (deviceId: number | null) => {
      if (deviceId !== null) await removePushDevice(deviceId);
      await unsubscribeBrowser();
    },
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, categories }: { id: number; categories: Record<string, boolean> }) =>
      updatePushDevice(id, { categories }),
    onSuccess: (device) =>
      queryClient.setQueryData<PushOverview>(qk.push, (old) =>
        old
          ? {
              ...old,
              devices: old.devices.map((entry) => (entry.id === device.id ? device : entry)),
            }
          : old,
      ),
  });

  const remove = useMutation({
    mutationFn: (id: number) => removePushDevice(id),
    onSettled: refresh,
  });

  const test = useMutation({
    mutationFn: (id: number) => testPushDevice(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.push }),
  });

  return { enable, disable, update, remove, test, refresh };
}
