'use client';

import { createContext, useContext } from 'react';

// Closes the panel tab a tool is shown in (an embedded tool's "Tab schließen" when it does
// not answer, Auftrag 116); null outside the panel.
export const PanelToolCloseCtx = createContext<(() => void) | null>(null);

export function usePanelToolClose(): (() => void) | null {
  return useContext(PanelToolCloseCtx);
}
