'use client';

import { useCallback } from 'react';
import { useLocalValue } from '@/hooks/useLocalValue';

// The width of the sidebar the member chose (owner, O110): dragged on its edge, kept on this
// device for this member (their own key, so two members of one browser keep their own) and
// clamped to what the layout allows.
export const SIDEBAR_DEFAULT = 248;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;

export function clampSidebarWidth(width: number, viewport: number): number {
  // The page beside it keeps at least this much room.
  const room = Math.max(SIDEBAR_MIN, viewport - 560);
  return Math.min(Math.min(SIDEBAR_MAX, room), Math.max(SIDEBAR_MIN, Math.round(width)));
}

export function parseSidebarWidth(stored: string | null): number {
  const value = stored == null ? NaN : Number(stored);
  return Number.isFinite(value) ? value : SIDEBAR_DEFAULT;
}

export function useSidebarWidth(userId: string | null | undefined) {
  const key = `helena:sidebar-width:${userId ?? 'anonymous'}`;
  const [stored, setStored] = useLocalValue(key);
  const set = useCallback((width: number) => setStored(String(width)), [setStored]);
  return { width: parseSidebarWidth(stored), set };
}
