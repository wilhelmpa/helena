'use client';

import { useLocale, useTranslations } from 'next-intl';
import { resolveText, type LocalizedText } from '@helena/sdk/web';

// A category's label or description as the API sends it: a key of Helena's own messages
// (`account.notifications.categories.<id>.label`), or a plugin's text per language.
export function useCategoryText() {
  const t = useTranslations();
  const locale = useLocale();
  return (text: LocalizedText | null | undefined): string => {
    if (!text) return '';
    return resolveText(text, locale, (key) => (t.has(key as never) ? t(key as never) : key));
  };
}
