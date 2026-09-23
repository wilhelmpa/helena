'use client';

import { useCallback, useContext, useSyncExternalStore } from 'react';
import { ShellCtx } from '@/context/shellContext';

// The draft the compose panel shows. It lives outside React state so the inbox, a
// task and the panel share it, and in localStorage so a reload keeps it open.
const KEY = 'mail:compose:draft';
const listeners = new Set<() => void>();
let current: number | null | undefined;
// A draft just started from the inbox or a task, not yet opened by the editor.
let fresh: number | null = null;

function stored(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function snapshot(): number | null {
  if (current === undefined) current = stored();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setComposeDraft(draftId: number | null, started = false): void {
  current = draftId;
  fresh = started ? draftId : null;
  try {
    if (draftId == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(draftId));
  } catch {
    // The panel still shows the draft until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

// True once for a draft that was just started, so the editor opens it with the cursor
// above the quoted mail.
export function takeFreshDraft(draftId: number): boolean {
  if (fresh !== draftId) return false;
  fresh = null;
  return true;
}

export function useComposeDraft(): number | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

// Shows a draft in the mail tool of the right-side panel.
export function useOpenCompose(): (draftId: number, started?: boolean) => void {
  const shell = useContext(ShellCtx);
  return useCallback(
    (draftId: number, started = false) => {
      setComposeDraft(draftId, started);
      shell?.onOpenWorkspaceTool?.('mail');
    },
    [shell],
  );
}
