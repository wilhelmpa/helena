import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// False while the server renders and during hydration, true afterwards: for what may only
// be read in the browser (the session in the store, window).
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
