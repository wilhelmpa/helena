import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';

// The page owns scope switches; its browser owns folder/file switches.
// Both receive the same editor dirty state without changing any route semantics.
export function useFileNavigationGuard(onDirtyChange?: (dirty: boolean) => void) {
  const dirty = useRef(false);
  const t = useTranslations('files.unified');
  const onDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );
  const canLeave = () => !dirty.current || window.confirm(t('discard'));
  return { onDirty, canLeave };
}
