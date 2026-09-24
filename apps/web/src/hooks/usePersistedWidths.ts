import { useCallback, useMemo } from 'react';
import { useLocalValue } from './useLocalValue';

// Several widths the user drags, by name, clamped to [min, max] and kept together under
// one `storageKey` (the areas docked beside the page in one workspace layout). Read
// through useLocalValue, so the server render and hydration use `initial`.
export function usePersistedWidths(
  storageKey: string,
  initial: number,
  min: number,
  max: number,
): { widthOf: (name: string) => number; setWidth: (name: string, width: number) => void } {
  const [raw, write] = useLocalValue(storageKey);
  const widths = useMemo(() => parse(raw), [raw]);

  const clamp = useCallback(
    (width: number) => Math.min(max, Math.max(min, Math.round(width))),
    [max, min],
  );

  const widthOf = useCallback(
    (name: string) => {
      const stored = widths[name];
      return stored === undefined ? initial : clamp(stored);
    },
    [clamp, initial, widths],
  );

  const setWidth = useCallback(
    (name: string, width: number) => write(JSON.stringify({ ...widths, [name]: clamp(width) })),
    [clamp, widths, write],
  );

  return { widthOf, setWidth };
}

function parse(raw: string | null): Record<string, number> {
  try {
    const value = JSON.parse(raw ?? '{}') as unknown;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}
