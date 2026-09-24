import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// False on the server and in the first client render, true after hydration. For a
// value the client knows before the server does (the session, read from the store on
// hydration), so the server markup and the first client render stay identical.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
