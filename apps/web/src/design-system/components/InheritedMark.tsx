'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import { Button } from './Button';
import { Pill } from './Pill';

// Where a project setting stands against Ava's default for every project (Auftrag 117,
// docs/einstellungen-struktur.md): "erbt von Ava" in quiet words while it follows the
// default, "für dieses Projekt geändert" with "zurücksetzen" once it does not. The same
// words and the same way back on every setting that exists on both levels.
export function InheritedMark({
  overridden,
  onReset,
  disabled = false,
}: {
  overridden: boolean;
  // Back to the default; without it (the reader may not change it) only the state shows.
  onReset?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('common.inherit');
  const appName = useDisplayName();
  if (!overridden)
    return (
      <span className="ds-inherited" data-state="inherited">
        {t('inherited', { appName })}
      </span>
    );
  return (
    <span className="ds-inherited" data-state="overridden">
      <Pill tone="accent">{t('overridden')}</Pill>
      {onReset && (
        <Button
          size="small"
          variant="ghost"
          icon={<RotateCcw size={14} />}
          disabled={disabled}
          onClick={onReset}
        >
          {t('reset')}
        </Button>
      )}
    </span>
  );
}
