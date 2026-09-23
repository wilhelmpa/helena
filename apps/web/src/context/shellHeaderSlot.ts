import { createContext, useContext } from 'react';

// The single-row header's page slot (docs/volition-design-helena-ui.md "einreihig"):
// the element in AppHeader a page's title bar renders its actions into, instead of a
// second header row under it. Null outside the Shell and in the 'classic' header
// layout, where the page keeps its own title bar.
export const ShellHeaderSlotCtx = createContext<HTMLElement | null>(null);

export function useShellHeaderSlot(): HTMLElement | null {
  return useContext(ShellHeaderSlotCtx);
}
