import { useCallback, useEffect, useState } from 'react';

export function usePersistedBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      setValue(saved === null ? initial : saved === 'true');
    } catch {
      /* Storage may be unavailable in private browser contexts. */
    }
  }, [key, initial]);
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* Keep in-memory state. */
      }
    },
    [key],
  );
  return [value, update] as const;
}
