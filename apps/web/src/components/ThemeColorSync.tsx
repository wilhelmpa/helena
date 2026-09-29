'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { themeColorFor } from '@/utils/app';

// The phone's status bar (theme-color) follows the theme chosen in Helena, not only the
// system's: the root layout ships one colour per `prefers-color-scheme` for the first
// paint, and once the chosen theme is known both tags carry its colour. Otherwise a light
// Helena on a phone in dark mode had a dark bar over a light header (owner, 29.09., O70).
export function syncThemeColor(doc: Document, theme: string | undefined) {
  const color = themeColorFor(theme);
  const tags = doc.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (tags.length === 0) {
    const tag = doc.createElement('meta');
    tag.name = 'theme-color';
    tag.content = color;
    doc.head.appendChild(tag);
    return;
  }
  for (const tag of tags) tag.content = color;
}

export default function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme) syncThemeColor(document, resolvedTheme);
  }, [resolvedTheme]);
  return null;
}
