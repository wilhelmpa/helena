import type { Status } from '@/components/common/page/StatusBadge';
import type {
  HostHealthItem,
  HostHealthState,
  PowerStatus,
  ServerOverview,
} from '@/lib/api/endpoints/server';
import { formatDuration, formatDurationShort, getDisplayLocale } from '@/utils/dates';

// Formatting and small decisions of the Server area, kept free of React so they are tested
// on their own.

export const SERVER_TABS = ['overview', 'disks', 'backup', 'power', 'updates'] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

export function isServerTab(value: string): value is ServerTab {
  return (SERVER_TABS as readonly string[]).includes(value);
}

// The tabs this host offers, in their order: a tab shows when one of its capabilities is
// available. `updates` stands outside the host helper (hub/update-center): it is offered
// whenever the update center is part of this build.
export function availableTabs(
  overview: Pick<ServerOverview, 'areas'> | undefined,
  updatesBuilt: boolean,
): ServerTab[] {
  const available = new Set(
    (overview?.areas ?? []).filter((area) => area.available).map((area) => area.area),
  );
  return SERVER_TABS.filter((tab) => (tab === 'updates' ? updatesBuilt : available.has(tab)));
}

export function healthStatus(state: HostHealthState): Status {
  if (state === 'critical') return 'danger';
  if (state === 'attention') return 'waiting';
  if (state === 'ok') return 'success';
  return 'idle';
}

const RANK: Record<HostHealthState, number> = { unknown: 0, ok: 1, attention: 2, critical: 3 };

export function worstState(states: Iterable<HostHealthState>): HostHealthState {
  let worst: HostHealthState = 'unknown';
  for (const state of states) if (RANK[state] > RANK[worst]) worst = state;
  return worst;
}

// Problems first (red, then amber), then the rest in their given order.
export function orderedHealth(items: HostHealthItem[]): HostHealthItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[b.item.state] - RANK[a.item.state] || a.index - b.index)
    .map(({ item }) => item);
}

// Disk sizes the way vendors print them (decimal: 2 TB).
export function formatDiskSize(bytes: number | null | undefined, locale = getDisplayLocale()) {
  if (bytes === null || bytes === undefined) return '–';
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

// Memory the way the firmware and the OS count it (binary, printed as GB like they do:
// the owner's BIOS says 96 GB for 96 GiB).
export function formatMemory(bytes: number | null | undefined, locale = getDisplayLocale()) {
  if (bytes === null || bytes === undefined) return '–';
  const gib = bytes / 1024 ** 3;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short',
    maximumFractionDigits: gib < 10 ? 1 : 0,
  }).format(gib);
}

export function formatPercent(value: number | null | undefined, locale = getDisplayLocale()) {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    value / 100,
  );
}

export function formatCelsius(value: number | null | undefined, locale = getDisplayLocale()) {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'celsius',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatWatts(value: number | null | undefined, locale = getDisplayLocale()) {
  if (value === null || value === undefined) return '–';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} W`;
}

// The values of a health line, formatted for its message: times as "vor 5 Min." /
// durations, sizes and temperatures in the display language.
export function healthValues(
  item: HostHealthItem,
  locale = getDisplayLocale(),
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(item.values ?? {})) {
    if (key === 'at' && typeof value === 'string')
      values[key] = value ? formatDurationShort(value) : '';
    else if (key === 'remaining' && typeof value === 'number')
      values[key] = formatDuration(value * 1000);
    else if (key === 'percent' && typeof value === 'number')
      values[key] = formatPercent(value, locale);
    else if (key === 'available' && typeof value === 'number')
      values[key] = formatMemory(value, locale);
    else if (key === 'temperature' && typeof value === 'number')
      values[key] = formatCelsius(value, locale);
    else values[key] = value;
  }
  return values;
}

// The fans as one choice: "auto", or the level all three share.
export function fansChoice(power: PowerStatus | undefined): 'auto' | number | null {
  const desired = power?.desired.fans;
  if (desired?.mode === 'auto') return 'auto';
  if (desired?.mode === 'fixed' && desired.level) return desired.level;
  if (power?.fans?.mode === 'auto') return 'auto';
  if (power?.fans?.mode === 'fixed' && power.fans.level) return power.fans.level;
  return null;
}

// The steps of a folder path, for the breadcrumb of the snapshot browser.
export function pathSteps(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: '/' + parts.slice(0, index + 1).join('/') })),
  ];
}

export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');
}

// Where a copy of a restore lands (the helper decides; this names it before it runs).
export function restoreTarget(path: string, ownerHome: string | null): 'home' | 'restoreDir' {
  return ownerHome && (path === ownerHome || path.startsWith(`${ownerHome}/`))
    ? 'home'
    : 'restoreDir';
}
