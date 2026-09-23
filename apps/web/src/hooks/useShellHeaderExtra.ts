import { useEffect, type ReactNode } from 'react';
import { useShell } from '@/context/shellContext';

// Registers content into the Shell's single-row header — the merged view tabs/
// filter bar (docs/volition-design-helena-ui.md "einreihig"). A page calls this
// with the same element it would otherwise render as its own second row, and
// renders nothing itself when the Shell is in 'single' layout; pass null (or skip
// the call) in 'classic' layout, where the page keeps rendering that row itself.
// The element is handed over after every render, and taken back on unmount.
export function useShellHeaderExtra(node: ReactNode | null): void {
  const { headerExtra } = useShell();
  useEffect(() => {
    headerExtra.set(node);
  });
  useEffect(() => () => headerExtra.set(null), [headerExtra]);
}
