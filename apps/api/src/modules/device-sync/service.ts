import { HttpError } from '#shared/lib';
import {
  SyncthingUnavailable,
  syncthingFind,
  syncthingJson,
  syncthingQrCode,
  syncthingWrite,
  type SyncthingProblem,
} from './syncthing';

// The Syncthing folder that holds the vault, created by the native Syncthing setup.
const FOLDER = 'volition';
const FILE_ERROR_LIMIT = 20;

// Syncthing names the older copy of a conflicting file
// <name>.sync-conflict-<date>-<time>-<device><.ext>.
const CONFLICT_MARKER = /\.sync-conflict-\d{8}-\d{6}-[A-Z2-7]{7}/;

interface FolderConfig {
  label: string;
  path: string;
  devices: { deviceID: string }[];
}

interface PendingDeviceEntry {
  time: string;
  name: string;
  address: string;
}

interface BrowseEntry {
  name: string;
  modTime: string;
  size: number;
  children?: BrowseEntry[];
}

export interface SyncServerDto {
  deviceId: string;
  qrCode: string;
  version: string;
  lanAddress: string | null;
  localDiscovery: boolean;
  globalDiscovery: boolean;
  relays: boolean;
}

export interface SyncFolderDto {
  label: string;
  path: string;
  state: string;
  stateChangedAt: string | null;
  lastScanAt: string | null;
  lastFileAt: string | null;
  lastFileName: string | null;
  needItems: number;
  error: string | null;
  fileErrorCount: number;
  fileErrors: { path: string; error: string }[];
}

export interface SyncDeviceDto {
  deviceId: string;
  name: string;
  connected: boolean;
  paused: boolean;
  address: string | null;
  lastSeenAt: string | null;
  sharesFolder: boolean;
}

export interface PendingDeviceDto {
  deviceId: string;
  name: string;
  address: string;
  requestedAt: string | null;
}

export interface DeviceSyncStatusDto {
  state: 'ready' | SyncthingProblem;
  checkedAt: string;
  server: SyncServerDto | null;
  folder: SyncFolderDto | null;
  devices: SyncDeviceDto[];
  pendingDevices: PendingDeviceDto[];
}

export interface ConflictFileDto {
  path: string;
  originalPath: string;
  modifiedAt: string;
  size: number;
}

// Syncthing reports a time it has not seen as Go's zero time or the Unix epoch.
function seenAt(value: string | undefined): string | null {
  const time = value ? new Date(value) : null;
  return time && time.getUTCFullYear() > 1970 ? time.toISOString() : null;
}

async function readFolder(): Promise<{ dto: SyncFolderDto; devices: Set<string> } | null> {
  const config = await syncthingFind<FolderConfig>(`/rest/config/folders/${FOLDER}`);
  if (!config) return null;
  const [status, stats, errors] = await Promise.all([
    syncthingJson<{
      state: string;
      stateChanged: string;
      error: string;
      needTotalItems: number;
      pullErrors: number;
    }>(`/rest/db/status?folder=${FOLDER}`),
    syncthingJson<Record<string, { lastScan: string; lastFile: { at: string; filename: string } }>>(
      '/rest/stats/folder',
    ),
    syncthingJson<{ errors: { path: string; error: string }[] | null }>(
      `/rest/folder/errors?folder=${FOLDER}&page=1&perpage=${FILE_ERROR_LIMIT}`,
    ),
  ]);
  const folderStats = stats[FOLDER];
  return {
    devices: new Set(config.devices.map((device) => device.deviceID)),
    dto: {
      label: config.label,
      path: config.path,
      state: status.state,
      stateChangedAt: seenAt(status.stateChanged),
      lastScanAt: seenAt(folderStats?.lastScan),
      lastFileAt: seenAt(folderStats?.lastFile.at),
      lastFileName: folderStats?.lastFile.filename || null,
      needItems: status.needTotalItems,
      error: status.error || null,
      fileErrorCount: status.pullErrors,
      fileErrors: errors.errors ?? [],
    },
  };
}

async function readStatus(): Promise<Omit<DeviceSyncStatusDto, 'state' | 'checkedAt'>> {
  const { myID } = await syncthingJson<{ myID: string }>('/rest/system/status');
  const [version, options, qrCode, devices, connections, deviceStats, pending, folder] =
    await Promise.all([
      syncthingJson<{ version: string }>('/rest/system/version'),
      syncthingJson<{
        localAnnounceEnabled: boolean;
        globalAnnounceEnabled: boolean;
        relaysEnabled: boolean;
      }>('/rest/config/options'),
      syncthingQrCode(myID),
      syncthingJson<{ deviceID: string; name: string; paused: boolean }[]>('/rest/config/devices'),
      syncthingJson<{ connections: Record<string, { connected: boolean; address: string }> }>(
        '/rest/system/connections',
      ),
      syncthingJson<Record<string, { lastSeen: string }>>('/rest/stats/device'),
      syncthingJson<Record<string, PendingDeviceEntry>>('/rest/cluster/pending/devices'),
      readFolder(),
    ]);
  return {
    server: {
      deviceId: myID,
      qrCode,
      version: version.version,
      lanAddress: process.env.SYNCTHING_LAN_ADDRESS?.trim() || null,
      localDiscovery: options.localAnnounceEnabled,
      globalDiscovery: options.globalAnnounceEnabled,
      relays: options.relaysEnabled,
    },
    folder: folder?.dto ?? null,
    devices: devices
      .filter((device) => device.deviceID !== myID)
      .map((device) => {
        const connection = connections.connections[device.deviceID];
        return {
          deviceId: device.deviceID,
          name: device.name,
          connected: connection?.connected ?? false,
          paused: device.paused,
          address: connection?.connected ? connection.address : null,
          lastSeenAt: seenAt(deviceStats[device.deviceID]?.lastSeen),
          sharesFolder: folder?.devices.has(device.deviceID) ?? false,
        };
      }),
    pendingDevices: Object.entries(pending).map(([deviceId, request]) => ({
      deviceId,
      name: request.name,
      address: request.address,
      requestedAt: seenAt(request.time),
    })),
  };
}

// Reports why Syncthing cannot be reached instead of failing, so the page can say so.
export async function deviceSyncStatus(): Promise<DeviceSyncStatusDto> {
  const checkedAt = new Date().toISOString();
  try {
    return { state: 'ready', checkedAt, ...(await readStatus()) };
  } catch (error) {
    if (!(error instanceof SyncthingUnavailable)) throw error;
    return {
      state: error.reason,
      checkedAt,
      server: null,
      folder: null,
      devices: [],
      pendingDevices: [],
    };
  }
}

// Adds a device that asked to connect and shares the vault folder with it.
export async function acceptDevice(deviceId: string): Promise<void> {
  const pending = await syncthingJson<Record<string, PendingDeviceEntry>>(
    '/rest/cluster/pending/devices',
  );
  const request = pending[deviceId];
  if (!request) throw new HttpError(404, 'No pending request from this device');
  const folder = await syncthingFind<FolderConfig>(`/rest/config/folders/${FOLDER}`);
  if (!folder) throw new HttpError(409, 'The folder Volition is not set up');
  await syncthingWrite('/rest/config/devices', 'POST', { deviceID: deviceId, name: request.name });
  if (!folder.devices.some((device) => device.deviceID === deviceId)) {
    await syncthingWrite(`/rest/config/folders/${FOLDER}`, 'PATCH', {
      devices: [...folder.devices, { deviceID: deviceId }],
    });
  }
}

// Syncthing also takes a removed device off every folder it was shared with.
export async function removeDevice(deviceId: string): Promise<void> {
  const { myID } = await syncthingJson<{ myID: string }>('/rest/system/status');
  if (deviceId === myID) throw new HttpError(400, 'This server cannot remove itself');
  if (!(await syncthingFind(`/rest/config/devices/${deviceId}`))) {
    throw new HttpError(404, 'Device not found');
  }
  await syncthingWrite(`/rest/config/devices/${deviceId}`, 'DELETE');
}

function conflictFiles(entries: BrowseEntry[], parent = ''): ConflictFileDto[] {
  return entries.flatMap((entry) => {
    const path = parent + entry.name;
    if (entry.children) return conflictFiles(entry.children, `${path}/`);
    if (!CONFLICT_MARKER.test(entry.name)) return [];
    return [
      {
        path,
        originalPath: parent + entry.name.replace(CONFLICT_MARKER, ''),
        modifiedAt: new Date(entry.modTime).toISOString(),
        size: entry.size,
      },
    ];
  });
}

// Read from Syncthing's index, which covers every synced file, Private/ included.
export async function listConflicts(): Promise<{ items: ConflictFileDto[] }> {
  const tree = await syncthingJson<BrowseEntry[]>(`/rest/db/browse?folder=${FOLDER}`);
  const items = conflictFiles(tree);
  return { items: items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) };
}
