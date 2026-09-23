import type { ReactNode } from 'react';

// What the active page puts into the Shell's single-row header. A store rather than
// Shell state: setting Shell state re-renders the page, which builds a new element
// and sets it again, without end — and the router never gets to navigate.
export type HeaderExtraStore = {
  get: () => ReactNode;
  set: (node: ReactNode) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createHeaderExtraStore(): HeaderExtraStore {
  let current: ReactNode = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(node) {
      if (node === current) return;
      current = node;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
