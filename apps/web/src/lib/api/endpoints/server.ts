import { request } from '@/lib/api/core/client';

// Administrator → Server (docs/helena-decisions/server-admin.md): the machine Helena runs on,
// read and changed through the API, which asks the host helper (helena-hostd). The shapes are
// the helper's own (apps/api/src/modules/server/types.ts); the overview and its health lines
// are Helena's.

export interface HostdCapabilities {
  version: string;
  system: boolean;
  storage: { raid: boolean; smart: boolean; efi: boolean };
  backup: { installed: boolean; initialized: boolean };
  power: { ec: boolean; os: boolean; ryzenadj: boolean };
}

export interface HostSystemStatus {
  hostname: string | null;
  kernel: string | null;
  boardVendor: string | null;
  boardName: string | null;
  productName: string | null;
  cpuModel: string | null;
  cpuCount: number | null;
  uptimeSeconds: number | null;
  load: number[];
  memory: {
    totalBytes: number | null;
    availableBytes: number | null;
    swapTotalBytes: number | null;
    swapFreeBytes: number | null;
    pressure: Record<string, { avg10: number; avg60: number }> | null;
    underPressure: boolean;
  };
  gpuMemory: {
    vramTotalBytes: number | null;
    vramUsedBytes: number | null;
    gttTotalBytes: number | null;
    gttUsedBytes: number | null;
  } | null;
  efi: boolean;
}

export type SyncAction = 'idle' | 'resync' | 'recover' | 'check' | 'repair' | 'reshape' | 'frozen';
export type HostState = 'ok' | 'attention' | 'critical' | 'unknown';

export interface RaidArray {
  kname: string;
  name: string;
  level: string | null;
  state: string | null;
  raidDisks: number | null;
  degraded: number;
  syncAction: SyncAction | null;
  syncPercent: number | null;
  syncSpeedKiB: number | null;
  syncRemainingSeconds: number | null;
  mismatchCount: number | null;
  members: { device: string; states: string[]; slot: number | null }[];
  health: HostState;
}

export interface SmartFacts {
  model: string | null;
  serial: string | null;
  firmware: string | null;
  capacityBytes: number | null;
  protocol: string | null;
  passed: boolean | null;
  failing: boolean;
  thresholdReached: boolean;
  errorLogEntries: number | null;
  temperatureC: number | null;
  powerOnHours: number | null;
  powerCycles: number | null;
  wearPercent: number | null;
  availableSpare: number | null;
  availableSpareThreshold: number | null;
  mediaErrors: number | null;
  criticalWarning: number | null;
  unsafeShutdowns: number | null;
  dataWrittenBytes: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  selfTestSupported: boolean;
  selfTestRunning: boolean | null;
  lastSelfTest: string | null;
  error?: string;
}

export interface HostDisk {
  kname: string;
  letter: string | null;
  model: string | null;
  serial: string | null;
  sizeBytes: number | null;
  transport: string | null;
  arrays: string[];
  mountpoints: string[];
  partitions: {
    kname: string;
    partlabel: string | null;
    partuuid: string | null;
    fstype: string | null;
    sizeBytes: number | null;
    mountpoints: string[];
  }[];
  smart: SmartFacts | null;
  health: HostState;
}

export interface BootEntry {
  number: string;
  active: boolean;
  label: string;
  partuuid: string | null;
  disk: string | null;
  loader?: string | null;
  vendorHardware?: boolean;
}

// One ESP's firmware entry judged by the host helper (see the API's types.ts).
export interface BootEntryCheck {
  role: 'main' | 'reserve';
  label: string;
  mount: string;
  espPresent: boolean;
  partuuid: string | null;
  number: string | null;
  state:
    | 'ok'
    | 'oldLayout'
    | 'missing'
    | 'noPartuuid'
    | 'wrongDisk'
    | 'wrongLoader'
    | 'inactive'
    | 'duplicate'
    | 'loaderMissing'
    | 'unchecked';
  entries: string[];
  foreign: string[];
}

// The last copy of the first ESP onto the second (after a package change).
export interface EspSyncState {
  state: 'ok' | 'skipped' | 'failed';
  reason: string | null;
  at: string | null;
  mount: string | null;
  pending: boolean | null;
  syncedAt: string | null;
  detail: string | null;
}

export interface StorageStatus {
  arrays: RaidArray[];
  disks: HostDisk[];
  esp: {
    mounts: {
      mount: string;
      mounted: boolean;
      source: string | null;
      files: number | null;
      bytes: number | null;
      digest: string | null;
    }[];
    inSync: boolean | null;
    differences: string[];
    differenceCount: number;
    sync?: EspSyncState | null;
    removable?: {
      mount: string;
      state: 'ok' | 'missing' | 'differs' | 'fallback' | 'stub' | 'unknown';
      detail: string | null;
    }[];
  };
  boot: {
    current: string | null;
    next: string | null;
    order: string[];
    timeoutSeconds: number | null;
    entries: BootEntry[];
    error?: string;
  } | null;
  reserveEntry: BootEntry | null;
  bootEntries?: BootEntryCheck[];
  checkedAt: string;
}

export type PowerProfile = 'saver' | 'balanced' | 'performance';

export interface PowerStatus {
  available: { ec: boolean; os: boolean; ryzenadj: boolean; smuDriver: boolean };
  board: string | null;
  profile: PowerProfile | 'mixed' | null;
  desired: {
    profile?: PowerProfile | null;
    fans?: { mode: 'auto' | 'fixed'; level: number | null } | null;
  };
  ec: {
    powerMode: string | null;
    temperatureC: number | null;
    temperatureMaxC: number | null;
    fans: {
      id: string;
      role: string;
      rpm: number | null;
      mode: string | null;
      level: number | null;
    }[];
  } | null;
  fans: { mode: 'auto' | 'fixed' | 'curve' | 'mixed'; level: number | null } | null;
  os: { profile: string | null; error?: string } | null;
  cpu: { driver: string | null; governor: string | null; epp: string | null };
  ryzenadj: {
    available: boolean;
    reason?: string;
    error?: string;
    family?: string | null;
    stapmLimitW?: number | null;
    stapmValueW?: number | null;
    fastLimitW?: number | null;
    fastValueW?: number | null;
    slowLimitW?: number | null;
    slowValueW?: number | null;
    tctlLimitC?: number | null;
    tctlValueC?: number | null;
  } | null;
  profiles: Record<
    PowerProfile,
    {
      ec: string;
      os: string;
      ecLimitsW: { stapm: number; fast: number; slow: number };
      override: Record<string, number> | null;
    }
  >;
  temperatures: {
    sensor: string;
    id: string;
    label: string | null;
    celsius?: number;
    watts?: number;
    // NVMe: the drive's block device (nvme0n1).
    disk?: string | null;
  }[];
  cpuTemperatureC: number | null;
  guard: {
    limit?: number;
    holdSeconds?: number;
    releaseBelow?: number;
    releaseSeconds?: number;
    state: {
      active: boolean;
      reason?: string | null;
      engagedAt?: string | null;
      releasedAt?: string | null;
      peakC?: number | null;
      lastTemperatureC?: number | null;
      available?: boolean;
      updatedAt?: string | null;
    };
  };
}

export interface BackupRunResult {
  ok: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  error?: string | null;
  warning?: string | null;
  snapshot?: string | null;
  filesNew?: number | null;
  filesChanged?: number | null;
  filesTotal?: number | null;
  bytesTotal?: number | null;
  dataAddedBytes?: number | null;
  repositoryBytes?: number | null;
  unreadable?: number | null;
  files?: number | null;
  filesRestored?: number | null;
  database?: { name: string; tables: number; bytes: number } | null;
  databases?: { database: string; bytes: number }[];
  targets?: { id: string; ok: boolean; error?: string }[];
}

export interface BackupSchedule {
  frequency: 'off' | 'hourly' | 'every6h' | 'daily';
  time: string;
}

export interface BackupRetention {
  hourly: number;
  daily: number;
  weekly: number;
  monthly: number;
}

export interface BackupTarget {
  id: string;
  kind: string;
  repository: string;
  enabled: boolean;
  lastCopy: { at: string; ok: boolean; error?: string } | null;
}

export interface RestoreJob {
  id: string;
  snapshot: string;
  path: string;
  mode: 'copy' | 'original';
  state: 'queued' | 'running' | 'done' | 'failed';
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  location?: string | null;
  movedAside?: string | null;
  error?: string | null;
  actor?: string | null;
}

export interface BackupStatus {
  installed: boolean;
  initialized: boolean;
  repository: string;
  passwordState: 'missing' | 'unrevealed' | 'acknowledged';
  schedule: BackupSchedule;
  retention: BackupRetention;
  checkWeekly: boolean;
  restoreTestMonthly: boolean;
  running: { backup: boolean; maintenance: boolean; 'restore-test': boolean };
  next: { backup: string | null; maintenance: string | null; 'restore-test': string | null };
  last: {
    backup: BackupRunResult | null;
    maintenance: BackupRunResult | null;
    'restore-test': BackupRunResult | null;
  };
  targets: BackupTarget[];
  paths: string[];
  ownerHome: string | null;
  history: {
    kind: string;
    ok: boolean;
    warning?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    snapshot?: string | null;
    dataAddedBytes?: number | null;
    error?: string | null;
  }[];
  restores: RestoreJob[];
}

export interface BackupSnapshot {
  id: string;
  shortId: string;
  time: string;
  hostname: string | null;
  paths: string[];
  tags: string[];
  filesTotal: number | null;
  bytesTotal: number | null;
  dataAddedBytes: number | null;
}

export interface BackupListing {
  snapshot: string;
  path: string;
  entries: {
    name: string;
    path: string;
    type: string;
    size: number | null;
    mtime: string | null;
  }[];
  truncated: boolean;
}

export interface HostEvent {
  id: number;
  at: string;
  source: string;
  severity: 'info' | 'warning' | 'critical';
  code: string;
  device: string | null;
  message: string | null;
}

export interface HostEvents {
  events: HostEvent[];
  seenUpTo: number;
  unseen: number;
  unseenCritical: number;
}

export type HostHealthState = HostState;

export interface HostHealthItem {
  id: string;
  state: HostHealthState;
  code?: string;
  values?: Record<string, string | number>;
  text?: string | { i18n: string } | Record<string, string>;
  since?: string | null;
}

export interface ServerCapability {
  id: string;
  pluginId: string;
  area: string;
  order: number;
  label: string | { i18n: string } | Record<string, string>;
  available: boolean;
  reason: string | null;
  detail: string | null;
  health: HostHealthItem[];
}

export interface ServerOverview {
  helper: { available: boolean; version: string | null; reason: string | null };
  areas: { area: string; available: boolean }[];
  capabilities: ServerCapability[];
  state: HostHealthState;
  checkedAt: string;
}

export interface DisksReading {
  storage: StorageStatus;
  events: HostEvents | null;
}

export type BackupReading = BackupStatus & { remoteTargets: boolean };

const fresh = (value?: boolean) => (value ? '?fresh=true' : '');
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const getServerOverview = () => request<ServerOverview>('/god/server');
export const getServerSystem = (refresh?: boolean) =>
  request<HostSystemStatus>(`/god/server/system${fresh(refresh)}`);
export const getServerDisks = (refresh?: boolean) =>
  request<DisksReading>(`/god/server/disks${fresh(refresh)}`);
export const getServerPower = (refresh?: boolean) =>
  request<PowerStatus>(`/god/server/power${fresh(refresh)}`);
export const getServerBackup = (refresh?: boolean) =>
  request<BackupReading>(`/god/server/backup${fresh(refresh)}`);
export const getBackupSnapshots = () =>
  request<{ snapshots: BackupSnapshot[] }>('/god/server/backup/snapshots');
export const listSnapshotFolder = (snapshot: string, path: string) =>
  request<BackupListing>(
    `/god/server/backup/snapshots/${encodeURIComponent(snapshot)}/files?path=${encodeURIComponent(path)}`,
  );
export const getRestore = (id: string) =>
  request<RestoreJob>(`/god/server/backup/restores/${encodeURIComponent(id)}`);
export const getServerEvents = () => request<HostEvents>('/god/server/events');

export const markServerEventsSeen = (upTo: number) =>
  request<{ seenUpTo: number }>('/god/server/events/seen', json('POST', { upTo }));
export const startRaidCheck = (array: string) =>
  request<unknown>(`/god/server/disks/arrays/${encodeURIComponent(array)}/check`, json('POST'));
export const stopRaidCheck = (array: string) =>
  request<unknown>(`/god/server/disks/arrays/${encodeURIComponent(array)}/check`, json('DELETE'));
export const startSelfTest = (disk: string) =>
  request<unknown>(`/god/server/disks/${encodeURIComponent(disk)}/self-test`, json('POST'));
export const bootReserveOnce = () =>
  request<{ next: string; label: string }>('/god/server/disks/boot-reserve', json('POST'));
export const cancelBootReserve = () =>
  request<{ next: null }>('/god/server/disks/boot-reserve', json('DELETE'));

export interface ProfileResult {
  profile: PowerProfile;
  layers: Record<string, { ok: boolean; value?: unknown; error?: string }>;
}
export const setPowerProfile = (profile: PowerProfile) =>
  request<ProfileResult>('/god/server/power/profile', json('PUT', { profile }));
export type FansChoice = { mode: 'auto' } | { mode: 'fixed'; level: number };
export const setFans = (choice: FansChoice) =>
  request<{ mode: string; level: number | null; applied: boolean; guardActive: boolean }>(
    '/god/server/power/fans',
    json('PUT', choice),
  );
export const setGuardLimit = (limit: number) =>
  request<unknown>('/god/server/power/guard', json('PUT', { limit }));

export type BackupRunKind = 'backup' | 'maintenance' | 'restore-test';
export const runBackup = (kind: BackupRunKind) =>
  request<unknown>('/god/server/backup/run', json('POST', { kind }));
export interface BackupSettingsPatch {
  schedule?: BackupSchedule;
  retention?: BackupRetention;
  checkWeekly?: boolean;
  restoreTestMonthly?: boolean;
}
export const setBackupSettings = (patch: BackupSettingsPatch) =>
  request<unknown>('/god/server/backup/settings', json('PUT', patch));
export interface RestoreRequest {
  snapshot: string;
  path: string;
  mode?: 'copy' | 'original';
  confirm?: string;
}
export const startRestore = (body: RestoreRequest) =>
  request<RestoreJob>('/god/server/backup/restores', json('POST', body));
export const revealBackupPassword = () =>
  request<{ password: string }>('/god/server/backup/password/reveal', json('POST'));
export const acknowledgeBackupPassword = () =>
  request<unknown>('/god/server/backup/password/acknowledge', json('POST'));
export interface TargetRequest {
  repository: string;
  enabled?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}
export const saveBackupTarget = (id: string, body: TargetRequest) =>
  request<BackupTarget>(`/god/server/backup/targets/${encodeURIComponent(id)}`, json('PUT', body));
export const removeBackupTarget = (id: string) =>
  request<unknown>(`/god/server/backup/targets/${encodeURIComponent(id)}`, json('DELETE'));
