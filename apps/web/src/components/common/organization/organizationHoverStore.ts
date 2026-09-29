import { useSyncExternalStore, type ReactNode } from 'react';
import type { ChartHover } from './OrganizationChartFlow';

// The team chart's hover card state, outside the chart's own state: only the card re-renders
// when the pointer moves over the nodes. The same node keeps its hover (a repeated enter must
// not start a new card).
export interface HoverStore {
  get: () => ChartHover | null;
  set: (next: ChartHover | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let current: ChartHover | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (current === next) return;
      if (current && next && current.node.id === next.node.id) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function HoverLayer({
  store,
  children,
}: {
  store: HoverStore;
  children: (hover: ChartHover) => ReactNode;
}) {
  const hover = useSyncExternalStore(store.subscribe, store.get, () => null);
  return hover ? children(hover) : null;
}
