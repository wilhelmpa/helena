import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  acceptSyncDevice,
  getDeviceSyncStatus,
  getSyncConflicts,
  removeSyncDevice,
  type PendingDevice,
} from '@/lib/api/endpoints/deviceSync';
import { deviceName } from '../utils/deviceName';

const keys = {
  status: ['deviceSync', 'status'] as const,
  conflicts: ['deviceSync', 'conflicts'] as const,
};

// Syncthing changes outside Plan, so no change marker covers it; the page asks again.
export const useDeviceSyncStatus = () =>
  useQuery({ queryKey: keys.status, queryFn: getDeviceSyncStatus, refetchInterval: 10_000 });

export const useSyncConflicts = () =>
  useQuery({ queryKey: keys.conflicts, queryFn: getSyncConflicts, refetchInterval: 60_000 });

// The toast names the step left on the device, which the page cannot show.
export function useAcceptDevice() {
  const client = useQueryClient();
  const t = useTranslations('devices.pending');
  return useMutation({
    mutationFn: (device: PendingDevice) => acceptSyncDevice(device.deviceId),
    onSuccess: (_, device) => {
      toast.success(t('accepted', { name: deviceName(device) }));
      return client.invalidateQueries({ queryKey: keys.status });
    },
  });
}

export function useRemoveDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: removeSyncDevice,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.status }),
  });
}
