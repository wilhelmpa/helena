import { resolveText, type AlertText, type LocalizedText } from '@helena/sdk';
import { formatPush } from '@helena/locales/push';

// Writes the texts of a push in a device's language. An alert of Helena's own sources names
// a message of the push translations (packages/locales/messages/<locale>/push.json) and its
// values; a plugin's alert brings its text per language.
export function alertText(text: AlertText, locale: string): string {
  if (typeof text === 'object' && typeof (text as { i18n?: unknown }).i18n === 'string') {
    const entry = text as { i18n: string; values?: Record<string, string | number> };
    return formatPush(locale, entry.i18n, entry.values ?? {});
  }
  return resolveText(text as LocalizedText, locale);
}
