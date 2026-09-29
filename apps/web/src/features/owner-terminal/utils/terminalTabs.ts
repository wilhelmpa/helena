import {
  OWNER_TERMINAL_OFFERED,
  type OwnerTerminalKind,
  type OwnerTerminalOfferedKind,
} from '@/lib/api/endpoints/owner-terminal';

export interface OpenTerminalTab {
  kind: OwnerTerminalKind;
  name: string;
}

export const tabKey = (tab: OpenTerminalTab) => `${tab.kind}:${tab.name}`;

// A fresh browser opens all four; Flash shows once the local model answers.
export const DEFAULT_TABS: OpenTerminalTab[] = OWNER_TERMINAL_OFFERED.map((kind) => ({
  kind,
  name: 'main',
}));

const offered = (kind: OwnerTerminalKind): kind is OwnerTerminalOfferedKind =>
  (OWNER_TERMINAL_OFFERED as readonly string[]).includes(kind);

export const isLocalKind = (kind: OwnerTerminalKind) => kind.startsWith('local-');

// The tabs a browser remembered, cleaned up: only the offered kinds, each once (the first
// one kept, so its tmux session — also `main-2` — reconnects). Nothing usable left: the
// four defaults.
export function normalizeTabs(stored: unknown): OpenTerminalTab[] {
  if (!Array.isArray(stored)) return DEFAULT_TABS;
  const seen = new Set<string>();
  const tabs: OpenTerminalTab[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, name } = entry as Partial<OpenTerminalTab>;
    if (typeof kind !== 'string' || typeof name !== 'string') continue;
    if (!offered(kind as OwnerTerminalKind) || seen.has(kind)) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) continue;
    seen.add(kind);
    tabs.push({ kind: kind as OwnerTerminalKind, name });
  }
  return tabs.length > 0 ? tabs : DEFAULT_TABS;
}

// A local model's tab only while that model is ready; the tab stays remembered.
export function visibleTabs(tabs: OpenTerminalTab[], readyLocal: ReadonlySet<string>) {
  return tabs.filter((tab) => !isLocalKind(tab.kind) || readyLocal.has(tab.kind));
}

// What "+" offers: the offered kinds that are not open yet (each terminal once), a local
// one only when its model is ready.
export function addableKinds(
  tabs: OpenTerminalTab[],
  readyLocal: ReadonlySet<string>,
): OwnerTerminalOfferedKind[] {
  const open = new Set(tabs.map((tab) => tab.kind));
  return OWNER_TERMINAL_OFFERED.filter(
    (kind) => !open.has(kind) && (!isLocalKind(kind) || readyLocal.has(kind)),
  );
}
