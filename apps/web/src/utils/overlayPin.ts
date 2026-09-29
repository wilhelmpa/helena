'use client';

import { useEffect, useSyncExternalStore } from 'react';

// The one overlay on the right, pinned (Auftrag 117): it stays open when the page changes,
// like the chat panel does. One overlay is pinned at a time; pinning another replaces it.
// It lives outside React (the Shell of Helena's pages and a project's Shell are different
// trees) and in the tab's session, so a reload keeps it too.
export type OverlayPinKind = 'issue' | 'agent' | 'run' | 'file' | 'receipt';

export interface OverlayPin {
  kind: OverlayPinKind;
  // Which one it is, in the overlay's own words ("VOL:42", "7", "7.123", a file's key).
  value: string;
  // What a host needs to show it again on another page, when the value is not enough
  // (a file's entry as JSON).
  data?: string;
}

export const OVERLAY_PIN_STORAGE_KEY = 'helena:overlay-pin';
const listeners = new Set<() => void>();
let current: OverlayPin | null | undefined;

function read(): OverlayPin | null {
  if (current !== undefined) return current;
  current = null;
  try {
    const raw = sessionStorage.getItem(OVERLAY_PIN_STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<OverlayPin>) : null;
    if (value && typeof value.kind === 'string' && typeof value.value === 'string')
      current = {
        kind: value.kind as OverlayPinKind,
        value: value.value,
        ...(typeof value.data === 'string' ? { data: value.data } : {}),
      };
  } catch {
    // no storage: nothing is pinned.
  }
  return current;
}

function write(next: OverlayPin | null) {
  current = next;
  try {
    if (next) sessionStorage.setItem(OVERLAY_PIN_STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(OVERLAY_PIN_STORAGE_KEY);
  } catch {
    // pinned for this page only.
  }
  listeners.forEach((listener) => listener());
}

export function pinOverlay(pin: OverlayPin) {
  write(pin);
}

// Unpins, or only the given overlay if it is the pinned one.
export function unpinOverlay(pin?: OverlayPin) {
  const now = read();
  if (pin && (!now || now.kind !== pin.kind || now.value !== pin.value)) return;
  write(null);
}

export function toggleOverlayPin(pin: OverlayPin) {
  const now = read();
  if (now && now.kind === pin.kind && now.value === pin.value) write(null);
  else write(pin);
}

export function pinnedOverlay(): OverlayPin | null {
  return read();
}

// Reset between tests.
export function resetOverlayPinForTest() {
  current = undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOverlayPin(): OverlayPin | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

// The pinned overlay of one kind, if one is.
export function usePinnedOverlay(kind: OverlayPinKind): OverlayPin | null {
  const pin = useOverlayPin();
  return pin?.kind === kind ? pin : null;
}

// Which overlays a page shows itself right now, so a host that brings back a pinned one
// on other pages does not show it a second time (the Wissen page with its own preview).
const shownHere = new Map<string, number>();
const shownListeners = new Set<() => void>();
const pinKey = (pin: Pick<OverlayPin, 'kind' | 'value'>) => `${pin.kind}\u0000${pin.value}`;

export function useOverlayShownHere(pin: Pick<OverlayPin, 'kind' | 'value'> | null) {
  const key = pin ? pinKey(pin) : null;
  useEffect(() => {
    if (!key) return;
    shownHere.set(key, (shownHere.get(key) ?? 0) + 1);
    shownListeners.forEach((listener) => listener());
    return () => {
      const count = (shownHere.get(key) ?? 1) - 1;
      if (count > 0) shownHere.set(key, count);
      else shownHere.delete(key);
      shownListeners.forEach((listener) => listener());
    };
  }, [key]);
}

export function useOverlayShownByPage(pin: Pick<OverlayPin, 'kind' | 'value'> | null): boolean {
  const key = pin ? pinKey(pin) : null;
  return useSyncExternalStore(
    (listener) => {
      shownListeners.add(listener);
      return () => shownListeners.delete(listener);
    },
    () => (key ? shownHere.has(key) : false),
    () => false,
  );
}
