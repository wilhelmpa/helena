import { useSyncExternalStore } from 'react';

// Whether Start's system details (the full health overview) are open. A store of its own,
// so the System tile and a red problem in "Braucht dich" open the same dialog, which Start
// mounts once.

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export const openSystemDetails = () => set(true);
export const closeSystemDetails = () => set(false);

export function useSystemDetailsOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}
