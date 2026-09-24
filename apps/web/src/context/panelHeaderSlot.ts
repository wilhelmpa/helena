import { createContext, useContext } from 'react';

// The tool panel's header slot: the element in WorkspacePanelHeader where the tool that
// is showing puts its own bar (the chat's title, new chat, menu) instead of a second row
// under the panel header. Null for a tool that is not the one showing (tools stay
// mounted while hidden), for the second tool of a split view, and outside the panel.
export const PanelHeaderSlotCtx = createContext<HTMLElement | null>(null);

export function usePanelHeaderSlot(): HTMLElement | null {
  return useContext(PanelHeaderSlotCtx);
}
