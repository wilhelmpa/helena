'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cleanFileName } from '../utils/vaultPaths';

// The note's file name. Changing it renames the file when the field is left.
export default function DocumentPageTitle({
  name,
  editable,
  autoFocus,
  onRename,
}: {
  name: string;
  editable: boolean;
  autoFocus: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const t = useTranslations('documents');
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);

  const commit = async () => {
    const clean = cleanFileName(value);
    if (!clean || clean === name) {
      setValue(name);
      return;
    }
    try {
      await onRename(clean);
    } catch {
      setValue(name);
    }
  };

  return (
    <textarea
      value={value}
      readOnly={!editable}
      autoFocus={autoFocus && editable}
      rows={1}
      maxLength={200}
      placeholder={t('untitled')}
      aria-label={t('noteTitle')}
      dir="auto"
      className="[field-sizing:content] min-h-8 w-full resize-none overflow-hidden bg-transparent pt-0.5 text-base font-semibold text-balance outline-none placeholder:text-muted-foreground/35"
      onFocus={(event) => {
        if (autoFocus) event.currentTarget.select();
      }}
      onChange={(event) => setValue(event.target.value.replace(/[\r\n]+/g, ''))}
      onBlur={() => {
        if (!cancelled.current) void commit();
        else setValue(name);
        cancelled.current = false;
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        cancelled.current = event.key === 'Escape';
        event.currentTarget.blur();
      }}
    />
  );
}
