// Administrator → Server as React Query hooks. The readings refresh on their own while a
// tab shows them (the power tab often: fans and temperatures move; the disks rarely: SMART
// is read at most once a minute on the machine), every change refreshes what it changed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acknowledgeBackupPassword,
  bootReserveOnce,
  cancelBootReserve,
  getBackupSnapshots,
  getRestore,
  getServerBackup,
  getServerDisks,
  getServerOverview,
  getServerPower,
  getServerSystem,
  listSnapshotFolder,
  markServerEventsSeen,
  removeBackupTarget,
  revealBackupPassword,
  runBackup,
  saveBackupTarget,
  setBackupSettings,
  setFans,
  setGuardLimit,
  setPowerProfile,
  startRaidCheck,
  startRestore,
  startSelfTest,
  stopRaidCheck,
  type BackupRunKind,
  type BackupSettingsPatch,
  type FansChoice,
  type HostHealthItem,
  type PowerProfile,
  type RestoreRequest,
  type TargetRequest,
} from '@/lib/api/endpoints/server';
import { UPDATES_TAB } from '../updatesTab';

export const serverKeys = {
  all: ['server'] as const,
  overview: ['server', 'overview'] as const,
  system: ['server', 'system'] as const,
  disks: ['server', 'disks'] as const,
  power: ['server', 'power'] as const,
  backup: ['server', 'backup'] as const,
  snapshots: ['server', 'snapshots'] as const,
  folder: (snapshot: string, path: string) => ['server', 'folder', snapshot, path] as const,
  restore: (id: string) => ['server', 'restore', id] as const,
};

export function useServerOverview(enabled = true) {
  return useQuery({
    queryKey: serverKeys.overview,
    queryFn: getServerOverview,
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: false,
  });
}

// Whether Administrator → Server has anything on this host: while the overview loads it is
// assumed (no flicker in the common case); a host without the helper hides it afterwards.
export function useServerAreaVisible(): boolean {
  const overview = useServerOverview();
  if (UPDATES_TAB.built) return true;
  if (!overview.data) return !overview.isError;
  return overview.data.areas.some((area) => area.available);
}

// The health lines the overview computed for one area (the API's view of the machine).
export function useAreaHealth(area: string): HostHealthItem[] {
  const overview = useServerOverview();
  return (overview.data?.capabilities ?? [])
    .filter((capability) => capability.area === area && capability.available)
    .flatMap((capability) => capability.health);
}

export function useServerSystem(enabled = true) {
  return useQuery({
    queryKey: serverKeys.system,
    queryFn: () => getServerSystem(),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useServerDisks(enabled = true) {
  return useQuery({
    queryKey: serverKeys.disks,
    queryFn: () => getServerDisks(),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useServerPower(enabled = true) {
  return useQuery({
    queryKey: serverKeys.power,
    queryFn: () => getServerPower(),
    enabled,
    refetchInterval: 5_000,
    retry: false,
  });
}

export function useServerBackup(enabled = true) {
  return useQuery({
    queryKey: serverKeys.backup,
    queryFn: () => getServerBackup(),
    enabled,
    // While a run is going its state changes every few seconds.
    refetchInterval: (query) =>
      query.state.data && Object.values(query.state.data.running).some(Boolean) ? 5_000 : 30_000,
    retry: false,
  });
}

export function useBackupSnapshots(enabled = true) {
  return useQuery({
    queryKey: serverKeys.snapshots,
    queryFn: getBackupSnapshots,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSnapshotFolder(snapshot: string | null, path: string) {
  return useQuery({
    queryKey: serverKeys.folder(snapshot ?? '', path),
    queryFn: () => listSnapshotFolder(snapshot!, path),
    enabled: snapshot !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRestore(id: string | null) {
  return useQuery({
    queryKey: serverKeys.restore(id ?? ''),
    queryFn: () => getRestore(id!),
    enabled: id !== null,
    refetchInterval: (query) =>
      query.state.data && ['done', 'failed'].includes(query.state.data.state) ? false : 2_000,
    retry: false,
  });
}

// A change: after it, the overview and the tab it changed are read again.
function useServerChange<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  refresh: readonly (readonly string[])[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: async () => {
      await Promise.all(
        [serverKeys.overview, ...refresh].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
}

export const useStartRaidCheck = () => useServerChange(startRaidCheck, [serverKeys.disks]);
export const useStopRaidCheck = () => useServerChange(stopRaidCheck, [serverKeys.disks]);
export const useStartSelfTest = () => useServerChange(startSelfTest, [serverKeys.disks]);
export const useBootReserveOnce = () =>
  useServerChange(() => bootReserveOnce(), [serverKeys.disks]);
export const useCancelBootReserve = () =>
  useServerChange(() => cancelBootReserve(), [serverKeys.disks]);
export const useMarkEventsSeen = () =>
  useServerChange(markServerEventsSeen, [serverKeys.disks, serverKeys.system]);

export const useSetPowerProfile = () =>
  useServerChange((profile: PowerProfile) => setPowerProfile(profile), [serverKeys.power]);
export const useSetFans = () =>
  useServerChange((choice: FansChoice) => setFans(choice), [serverKeys.power]);
export const useSetGuardLimit = () => useServerChange(setGuardLimit, [serverKeys.power]);

export const useRunBackup = () =>
  useServerChange((kind: BackupRunKind) => runBackup(kind), [serverKeys.backup]);
export const useSetBackupSettings = () =>
  useServerChange((patch: BackupSettingsPatch) => setBackupSettings(patch), [serverKeys.backup]);
export const useStartRestore = () =>
  useServerChange((body: RestoreRequest) => startRestore(body), [serverKeys.backup]);
export const useAcknowledgeBackupPassword = () =>
  useServerChange(() => acknowledgeBackupPassword(), [serverKeys.backup]);
export const useSaveBackupTarget = () =>
  useServerChange(
    ({ id, body }: { id: string; body: TargetRequest }) => saveBackupTarget(id, body),
    [serverKeys.backup],
  );
export const useRemoveBackupTarget = () =>
  useServerChange((id: string) => removeBackupTarget(id), [serverKeys.backup]);

// The password is never put into the query cache: it lives in the dialog's state only.
export function useRevealBackupPassword() {
  return useMutation({ mutationFn: revealBackupPassword, gcTime: 0 });
}
