'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

// A pinned overlay or panel does not lie over the page, it takes its room from it (owner
// 30.09., O103): the whole main area - header bar and page - gets that much narrower, nothing is
// covered, and the room comes back when the thing is unpinned or closed. What sits at the right
// edge registers its width here; the biggest one counts (a pinned chat and a pinned task
// share the edge, the later in front). The room is published as --ds-dock-inset on <html>,
// which .ds-main reads (design-system/shell.css). Below 1024px there is no docking: an overlay
// is a sheet over the whole screen there and has no pin.
export const DOCK_SHEET_QUERY = '(max-width: 1023px)';
const GAP = 12;
const entries = new Map<string, number>();
const listeners = new Set<() => void>();
let current = 0;

function publish() {
  const width = Math.max(0, ...entries.values());
  if (width !== current) {
    current = width;
    listeners.forEach((listener) => listener());
  }
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--ds-dock-inset',
    width > 0 ? `${width + GAP}px` : '0px',
  );
  document.documentElement.toggleAttribute('data-docked', width > 0);
}

// Registers `width` under `id` while it is a number; null (or unmounting) releases it.
export function useDock(id: string, width: number | null) {
  useEffect(() => {
    if (width == null) return;
    entries.set(id, width);
    publish();
    return () => {
      entries.delete(id);
      publish();
    };
  }, [id, width]);
}

// True below 1024px: overlays are sheets and cannot be pinned.
export function useSheetMode(): boolean {
  return useMediaQuery(DOCK_SHEET_QUERY);
}

// The width of what is docked now, 0 while nothing is (a sidebar steps aside for it).
export function useDockedWidth(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => 0,
  );
}
