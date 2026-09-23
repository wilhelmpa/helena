import { useEffect, type ReactNode } from 'react';
import { useShell } from '@/context/shellContext';

// Registers content into the Shell's single-row header — the merged view tabs/
// filter bar (docs/volition-design-helena-ui.md "einreihig"). A page calls this
// with the same element it would otherwise render as its own second row, and
// renders nothing itself when the Shell is in 'single' layout; pass null (or skip
// the call) in 'classic' layout, where the page keeps rendering that row itself.
// Unregisters on unmount and whenever `node` changes, so a page that stops needing
// the slot (or the header layout preference flips) never leaves stale content in it.
export function useShellHeaderExtra(node: ReactNode | null): void {
  const { setHeaderExtra } = useShell();
  useEffect(() => {
    setHeaderExtra(node);
    return () => setHeaderExtra(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}
