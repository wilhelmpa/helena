import type { Logger } from './common';
import type { LocalizedText } from './text';

// What the machine Helena runs on offers the Administrator (Administrator → Server): its disks
// and RAID, backups, power and fans, updates, or a plugin's own part of the host (a UPS, a ZFS
// pool). A host capability says whether this host has it at all, and reports health lines for
// the overview on Start. An installation without the root helper (a container) has none of the
// built-in ones, and the Server area hides what is not there.
// Decision: docs/helena-decisions/server-admin.md.

// `attention`: amber, something runs or needs a look (a rebuild, a check, a warm disk).
// `critical`: red, act now (a degraded array, a failing disk, a failed backup).
export type HostHealthState = 'ok' | 'attention' | 'critical' | 'unknown';

export const HOST_HEALTH_STATES: readonly HostHealthState[] = [
  'ok',
  'attention',
  'critical',
  'unknown',
];

// The built-in areas (tabs) of Administrator → Server. The UI of a capability's area comes
// from the web app for the built-ins and from `server-section` UI slots for the rest.
export const HOST_AREAS = ['overview', 'disks', 'backup', 'power', 'updates'] as const;
export type BuiltinHostArea = (typeof HOST_AREAS)[number];

export interface HostHealthItem {
  // Stable within the capability: `raid:helena-root`, `disk:A`, `backup:last`.
  id: string;
  state: HostHealthState;
  // Built-ins name a message of Helena's own translations (`server.health.<code>`) and its
  // values; a plugin gives the text itself.
  code?: string;
  values?: Record<string, string | number>;
  text?: LocalizedText;
  // ISO 8601: since when the state holds, where known.
  since?: string | null;
}

export type HostUnavailableReason = 'no_helper' | 'not_installed' | 'unsupported' | 'failed';

export interface HostAvailability {
  available: boolean;
  reason?: HostUnavailableReason;
  // A short English detail for the Administrator; never a path or a secret.
  detail?: string;
}

export interface HostCapabilityContext {
  now: Date;
  log: Logger;
  signal?: AbortSignal;
}

// A host capability (registry `hostCapabilities`, API process).
export interface HostCapability {
  id: string;
  label: LocalizedText;
  // The tab it belongs to: one of HOST_AREAS or the plugin's own.
  area: string;
  // Lower comes first within the area; built-ins leave gaps of 10.
  order?: number;
  probe(context: HostCapabilityContext): Promise<HostAvailability>;
  health?(context: HostCapabilityContext): Promise<HostHealthItem[]>;
}

const RANK: Record<HostHealthState, number> = { unknown: 0, ok: 1, attention: 2, critical: 3 };

export function isHostHealthState(value: unknown): value is HostHealthState {
  return typeof value === 'string' && (HOST_HEALTH_STATES as readonly string[]).includes(value);
}

export function worstHostHealth(states: Iterable<HostHealthState>): HostHealthState {
  let worst: HostHealthState = 'unknown';
  for (const state of states) if (RANK[state] > RANK[worst]) worst = state;
  return worst;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

// A plugin's health line as Helena keeps it: a known state, a bounded id and code, values of
// plain strings and numbers. Anything else is dropped rather than shown.
export function normalizeHostHealthItem(value: unknown): HostHealthItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !ID.test(item.id) || !isHostHealthState(item.state)) {
    return null;
  }
  const values: Record<string, string | number> = {};
  if (item.values && typeof item.values === 'object') {
    for (const [key, entry] of Object.entries(item.values as Record<string, unknown>)) {
      if (typeof entry === 'string') values[key] = entry.slice(0, 200);
      else if (typeof entry === 'number' && Number.isFinite(entry)) values[key] = entry;
    }
  }
  let text: LocalizedText | undefined;
  if (typeof item.text === 'string') text = item.text.slice(0, 300);
  else if (item.text && typeof item.text === 'object') {
    const entries = Object.entries(item.text as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (entries.length > 0) {
      text = Object.fromEntries(entries.map(([key, entry]) => [key, entry.slice(0, 300)]));
    }
  }
  return {
    id: item.id,
    state: item.state,
    ...(typeof item.code === 'string' && ID.test(item.code) ? { code: item.code } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(text ? { text } : {}),
    since: typeof item.since === 'string' ? item.since : null,
  };
}
