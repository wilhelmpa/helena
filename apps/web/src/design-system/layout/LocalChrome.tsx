'use client';

import type { ReactNode } from 'react';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';

// A part of a page that keeps its own toolbar and actions in place instead of sending them
// to the page's header row — for a page made of several former pages that each save on
// their own (Benachrichtigungen & Kanäle): every block shows its Save where it is, so the
// header never holds two "Speichern".
export function LocalChrome({ children }: { children: ReactNode }) {
  return (
    <ShellHeaderSlotCtx.Provider value={null}>
      <ShellHeaderActionsSlotCtx.Provider value={null}>
        {children}
      </ShellHeaderActionsSlotCtx.Provider>
    </ShellHeaderSlotCtx.Provider>
  );
}
