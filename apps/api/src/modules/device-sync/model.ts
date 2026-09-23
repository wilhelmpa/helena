import { t } from 'elysia';

// A Syncthing device ID: eight groups of seven base32 characters.
export const DeviceIdParams = t.Object({
  deviceId: t.String({ pattern: '^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$' }),
});

const SyncServer = t.Object({
  deviceId: t.String(),
  qrCode: t.String(),
  version: t.String(),
  lanAddress: t.Nullable(t.String()),
  localDiscovery: t.Boolean(),
  globalDiscovery: t.Boolean(),
  relays: t.Boolean(),
});

const SyncFolder = t.Object({
  label: t.String(),
  path: t.String(),
  state: t.String(),
  stateChangedAt: t.Nullable(t.String()),
  lastScanAt: t.Nullable(t.String()),
  lastFileAt: t.Nullable(t.String()),
  lastFileName: t.Nullable(t.String()),
  needItems: t.Number(),
  error: t.Nullable(t.String()),
  fileErrorCount: t.Number(),
  fileErrors: t.Array(t.Object({ path: t.String(), error: t.String() })),
});

const SyncDevice = t.Object({
  deviceId: t.String(),
  name: t.String(),
  connected: t.Boolean(),
  paused: t.Boolean(),
  address: t.Nullable(t.String()),
  lastSeenAt: t.Nullable(t.String()),
  sharesFolder: t.Boolean(),
});

const PendingDevice = t.Object({
  deviceId: t.String(),
  name: t.String(),
  address: t.String(),
  requestedAt: t.Nullable(t.String()),
});

export const DeviceSyncStatusResponse = t.Object({
  state: t.Union([t.Literal('ready'), t.Literal('unconfigured'), t.Literal('unreachable')]),
  checkedAt: t.String(),
  server: t.Nullable(SyncServer),
  folder: t.Nullable(SyncFolder),
  devices: t.Array(SyncDevice),
  pendingDevices: t.Array(PendingDevice),
});

export const ConflictListResponse = t.Object({
  items: t.Array(
    t.Object({
      path: t.String(),
      originalPath: t.String(),
      modifiedAt: t.String(),
      size: t.Number(),
    }),
  ),
});
