'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { copyText } from '@/utils/clipboard';

// A value that is long or technical (a hash, a commit, an address) shown shortened in mono
// type, with the whole value copied by one click. `display` is what shows, `value` what is
// copied; `label` names it for screen readers ("Prüfsumme kopieren").
export function CopyValue({
  value,
  display,
  label,
}: {
  value: string;
  display?: string;
  label: string;
}) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className="ds-copy-value"
      title={copied ? t('copied') : `${label}: ${value}`}
      aria-label={`${t('copy')}: ${label}`}
      onClick={() => {
        void copyText(value).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <span className="ds-copy-value-text">{display ?? value}</span>
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}
