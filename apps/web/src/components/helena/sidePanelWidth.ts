import { useCallback, useSyncExternalStore } from 'react';

// One width for every panel docked on the right (preview in Wissen and Belege, the chat and
// tool panel): dragging one resizes them all, and the width survives a reload. Kept in
// localStorage under one key, shared with the chat panel.
export const SIDE_PANEL_WIDTH_KEY = 'helena.sidePanelWidth';
export const SIDE_PANEL_MIN = 320;
export const SIDE_PANEL_DEFAULT = 380;
// At most this share of the viewport.
export const SIDE_PANEL_MAX_SHARE = 0.7;

const listeners = new Set<() => void>();
let memory: number | null = null;

export function clampSidePanelWidth(width: number, viewport: number): number {
  const max = Math.max(SIDE_PANEL_MIN, Math.floor(viewport * SIDE_PANEL_MAX_SHARE));
  return Math.round(Math.min(max, Math.max(SIDE_PANEL_MIN, width)));
}

function read(): number {
  if (memory !== null) return memory;
  try {
    const stored = Number(window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Storage blocked (private window): the default for this page view.
  }
  return SIDE_PANEL_DEFAULT;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SIDE_PANEL_WIDTH_KEY) return;
    memory = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setSidePanelWidth(width: number) {
  memory = Math.round(width);
  try {
    window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(memory));
  } catch {
    // Kept in memory for this page view.
  }
  for (const listener of listeners) listener();
}

// The stored width, not yet clamped to the viewport (the panel clamps when it draws).
export function useSidePanelWidth(): [number, (width: number) => void] {
  const width = useSyncExternalStore(subscribe, read, () => SIDE_PANEL_DEFAULT);
  const set = useCallback((next: number) => setSidePanelWidth(next), []);
  return [width, set];
}
