import {
  HOST_AREAS,
  consoleLogger,
  normalizeHostHealthItem,
  worstHostHealth,
  type HelenaPlugin,
  type HostAvailability,
  type HostCapability,
  type HostCapabilityContext,
  type HostHealthItem,
  type HostHealthState,
  type LocalizedText,
} from '@helena/sdk';
import { registries } from '#shared/helena';
import { HostdError, hostd } from './hostd';
import { localAiGuard } from '#modules/local-ai/guard';
import { backupHealth, powerHealth, storageHealth, systemHealth } from './health';
import type {
  BackupStatus,
  HostEvents,
  HostSystemStatus,
  HostdCapabilities,
  PowerStatus,
  StorageStatus,
} from './types';

// Administrator → Server: the machine Helena runs on, through helena-hostd. Reads are cached
// for a few seconds (the Start page, the Server tabs and the sidebar all ask), SMART data a
// little longer; a change drops the cache of what it changed.

const TTL_MS = {
  capabilities: 30_000,
  system: 10_000,
  storage: 30_000,
  power: 4_000,
  backup: 8_000,
  events: 8_000,
} as const;
type CacheKey = keyof typeof TTL_MS;

const cache = new Map<CacheKey, { at: number; value: Promise<unknown> }>();

function cached<T>(key: CacheKey, load: () => Promise<T>, fresh = false): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS[key]) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  // A failed read is not kept: the next request asks again.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function invalidate(...keys: CacheKey[]): void {
  for (const key of keys.length ? keys : (Object.keys(TTL_MS) as CacheKey[])) cache.delete(key);
}

export const hostCapabilities = (fresh = false) =>
  cached('capabilities', () => hostd<HostdCapabilities>('Capabilities', {}, 5_000), fresh);
export const systemStatus = (fresh = false) =>
  cached(
    'system',
    async () => ({ ...(await hostd<HostSystemStatus>('SystemStatus')), guard: localAiGuard() }),
    fresh,
  );
export const storageStatus = (fresh = false) =>
  cached(
    'storage',
    () => hostd<StorageStatus>('StorageStatus', fresh ? { fresh: true } : {}, 60_000),
    fresh,
  );
export const powerStatus = (fresh = false) =>
  cached('power', () => hostd<PowerStatus>('PowerStatus', fresh ? { fresh: true } : {}), fresh);
export const backupStatus = (fresh = false) =>
  cached('backup', () => hostd<BackupStatus>('BackupStatus'), fresh);
export const hostEvents = (fresh = false) =>
  cached('events', () => hostd<HostEvents>('Events', { limit: 100 }), fresh);

// ── The built-in host capabilities (internal plugin helena.server) ────────────────────────

async function helperAvailability(): Promise<HostAvailability> {
  try {
    await hostCapabilities();
    return { available: true };
  } catch (error) {
    if (error instanceof HostdError && error.code === 'Unavailable') {
      return { available: false, reason: 'no_helper' };
    }
    return {
      available: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const label = (key: string): LocalizedText => ({ i18n: `server.capabilities.${key}` });

export const BUILTIN_HOST_CAPABILITIES: HostCapability[] = [
  {
    id: 'helena.server.system',
    label: label('system'),
    area: 'overview',
    order: 0,
    probe: helperAvailability,
    health: async () => systemHealth(await systemStatus()),
  },
  {
    id: 'helena.server.storage',
    label: label('storage'),
    area: 'disks',
    order: 0,
    async probe() {
      const helper = await helperAvailability();
      if (!helper.available) return helper;
      const capabilities = await hostCapabilities();
      return capabilities.storage.raid || capabilities.storage.smart
        ? { available: true }
        : { available: false, reason: 'unsupported' };
    },
    async health() {
      const [storage, events] = await Promise.all([
        storageStatus(),
        hostEvents().catch(() => null),
      ]);
      return storageHealth(storage, events);
    },
  },
  {
    id: 'helena.server.backup',
    label: label('backup'),
    area: 'backup',
    order: 0,
    probe: helperAvailability,
    health: async () => backupHealth(await backupStatus()),
  },
  {
    id: 'helena.server.power',
    label: label('power'),
    area: 'power',
    order: 0,
    probe: helperAvailability,
    health: async () => powerHealth(await powerStatus()),
  },
];

export const SERVER_PLUGIN_ID = 'helena.server';

export const serverPlugin: HelenaPlugin = {
  register(ctx) {
    for (const capability of BUILTIN_HOST_CAPABILITIES) ctx.hostCapabilities.register(capability);
  },
};

// ── The overview ─────────────────────────────────────────────────────────────────────────

export interface CapabilityView {
  id: string;
  pluginId: string;
  area: string;
  order: number;
  label: LocalizedText;
  available: boolean;
  reason: string | null;
  detail: string | null;
  health: HostHealthItem[];
}

export interface ServerOverview {
  helper: { available: boolean; version: string | null; reason: string | null };
  areas: { area: string; available: boolean }[];
  capabilities: CapabilityView[];
  state: HostHealthState;
  checkedAt: string;
}

const PROBE_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function view(
  entry: { id: string; pluginId: string; value: HostCapability },
  context: HostCapabilityContext,
): Promise<CapabilityView> {
  const capability = entry.value;
  let availability: HostAvailability;
  try {
    availability = await withTimeout(capability.probe(context), PROBE_TIMEOUT_MS);
  } catch (error) {
    availability = {
      available: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  let health: HostHealthItem[] = [];
  if (availability.available && capability.health) {
    try {
      const items = await withTimeout(capability.health(context), PROBE_TIMEOUT_MS);
      health = items
        .map((item) => normalizeHostHealthItem(item))
        .filter((item): item is HostHealthItem => item !== null);
    } catch (error) {
      context.log.warn(`health of ${entry.id} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      health = [{ id: 'health', state: 'unknown', code: 'healthFailed', since: null }];
    }
  }
  return {
    id: entry.id,
    pluginId: entry.pluginId,
    area: capability.area,
    order: capability.order ?? 100,
    label: capability.label,
    available: availability.available,
    reason: availability.reason ?? null,
    detail: availability.detail ?? null,
    health,
  };
}

export async function serverOverview(): Promise<ServerOverview> {
  const context: HostCapabilityContext = { now: new Date(), log: consoleLogger('server') };
  const capabilities = await Promise.all(
    registries.hostCapabilities.entriesList().map((entry) => view(entry, context)),
  );
  const builtinOrder = new Map<string, number>(HOST_AREAS.map((area, index) => [area, index]));
  capabilities.sort(
    (a, b) =>
      (builtinOrder.get(a.area) ?? 99) - (builtinOrder.get(b.area) ?? 99) ||
      a.area.localeCompare(b.area) ||
      a.order - b.order,
  );
  const areas: { area: string; available: boolean }[] = [];
  for (const capability of capabilities) {
    const existing = areas.find((entry) => entry.area === capability.area);
    if (existing) existing.available ||= capability.available;
    else areas.push({ area: capability.area, available: capability.available });
  }
  let helper: ServerOverview['helper'];
  try {
    const found = await hostCapabilities();
    helper = { available: true, version: found.version, reason: null };
  } catch (error) {
    helper = {
      available: false,
      version: null,
      reason: error instanceof HostdError ? error.code : 'failed',
    };
  }
  return {
    helper,
    areas,
    capabilities,
    state: worstHostHealth(
      capabilities.flatMap((capability) => capability.health.map((item) => item.state)),
    ),
    checkedAt: new Date().toISOString(),
  };
}
