'use client';

import { useCallback, useSyncExternalStore } from 'react';

// How the chat bar at the bottom of the Werkzeug-Panel is left (Auftrag 116): open or
// closed and the height of the open chat area, remembered on this device.
export interface ChatDockPreference {
  expanded: boolean;
  height: number;
}

export const CHAT_DOCK_STORAGE_KEY = 'helena:chat-dock';
export const CHAT_DOCK_MIN_HEIGHT = 160;
// The open chat area leaves the tab above it at least this much of the panel.
export const CHAT_DOCK_MAX_RATIO = 0.75;
export const CHAT_DOCK_DEFAULT: ChatDockPreference = { expanded: false, height: 320 };

export function clampChatDockHeight(height: number, panelHeight?: number): number {
  const max =
    panelHeight && panelHeight > 0
      ? Math.max(CHAT_DOCK_MIN_HEIGHT, Math.floor(panelHeight * CHAT_DOCK_MAX_RATIO))
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(CHAT_DOCK_MIN_HEIGHT, height)));
}

export function parseChatDockPreference(raw: string | null): ChatDockPreference {
  if (!raw) return CHAT_DOCK_DEFAULT;
  try {
    const value = JSON.parse(raw) as Partial<ChatDockPreference>;
    return {
      expanded: value.expanded === true,
      height:
        typeof value.height === 'number' && Number.isFinite(value.height)
          ? clampChatDockHeight(value.height)
          : CHAT_DOCK_DEFAULT.height,
    };
  } catch {
    return CHAT_DOCK_DEFAULT;
  }
}

const listeners = new Set<() => void>();
let current: ChatDockPreference | null = null;

function load(): ChatDockPreference {
  if (current) return current;
  try {
    current = parseChatDockPreference(localStorage.getItem(CHAT_DOCK_STORAGE_KEY));
  } catch {
    // no storage (private mode): the default applies for this session.
    current = CHAT_DOCK_DEFAULT;
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHAT_DOCK_STORAGE_KEY) return;
    current = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function save(next: ChatDockPreference) {
  current = next;
  try {
    localStorage.setItem(CHAT_DOCK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

// Reset between tests.
export function resetChatDockPreferenceForTest() {
  current = null;
}

export function useChatDockPreference(): ChatDockPreference & {
  setExpanded: (expanded: boolean) => void;
  setHeight: (height: number) => void;
} {
  const preference = useSyncExternalStore(subscribe, load, () => CHAT_DOCK_DEFAULT);
  const setExpanded = useCallback((expanded: boolean) => save({ ...load(), expanded }), []);
  const setHeight = useCallback(
    (height: number) => save({ ...load(), height: clampChatDockHeight(height) }),
    [],
  );
  return { ...preference, setExpanded, setHeight };
}
