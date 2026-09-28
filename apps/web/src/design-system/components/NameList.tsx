'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// A list of names in running text ("Agenten auf diesem Konto: a, b, c +20"): the first
// few, then one button that shows the rest — never a paragraph of forty names
// (owner, 28.09.: "lange Fließtext-Liste aller Agenten").
export function NameList({ names, max = 3 }: { names: string[]; max?: number }) {
  const t = useTranslations('common.nameList');
  const [open, setOpen] = useState(false);
  const shown = open ? names : names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="ds-name-list">
      {shown.join(', ')}
      {rest > 0 && (
        <button type="button" className="ds-name-list-more" onClick={() => setOpen(true)}>
          {t('more', { count: rest })}
        </button>
      )}
    </span>
  );
}
