import { useCallback, useSyncExternalStore } from 'react';

// One value in localStorage as an external store React can read with
// useSyncExternalStore: the server render and hydration read null, the client the stored
// value, and every writer re-renders every reader of the key. When storage is off
// (private mode, blocked site data, a preview) a write still applies for the life of the
// page, from memory.

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function readLocal(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

// The raw stored string of `key` (null when unset or before hydration) and its writer.
export function useLocalValue(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => null,
  );
  const write = useCallback((next: string | null) => writeLocal(key, next), [key]);
  return [value, write];
}
