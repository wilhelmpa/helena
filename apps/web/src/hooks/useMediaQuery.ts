import { useSyncExternalStore } from 'react';

// Whether a CSS media query matches, following it live. False on the server and in the
// first client render, so both render the same markup.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
