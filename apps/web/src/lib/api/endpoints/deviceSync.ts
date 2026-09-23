import { request } from '@/lib/api/core/client';

export interface SyncServer {
  deviceId: string;
  qrCode: string;
  version: string;
  lanAddress: string | null;
  localDiscovery: boolean;
  globalDiscovery: boolean;
  relays: boolean;
}

export interface SyncFolder {
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

export interface SyncDevice {
  deviceId: string;
  name: string;
  connected: boolean;
  paused: boolean;
  address: string | null;
  lastSeenAt: string | null;
  sharesFolder: boolean;
}

export interface PendingDevice {
  deviceId: string;
  name: string;
  address: string;
  requestedAt: string | null;
}

export interface DeviceSyncStatus {
  state: 'ready' | 'unconfigured' | 'unreachable';
  checkedAt: string;
  server: SyncServer | null;
  folder: SyncFolder | null;
  devices: SyncDevice[];
  pendingDevices: PendingDevice[];
}

export interface ConflictFile {
  path: string;
  originalPath: string;
  modifiedAt: string;
  size: number;
}

export const getDeviceSyncStatus = () => request<DeviceSyncStatus>('/device-sync');

export const getSyncConflicts = () => request<{ items: ConflictFile[] }>('/device-sync/conflicts');

export const acceptSyncDevice = (deviceId: string) =>
  request<void>(`/device-sync/pending/${encodeURIComponent(deviceId)}/accept`, { method: 'POST' });

export const removeSyncDevice = (deviceId: string) =>
  request<void>(`/device-sync/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
