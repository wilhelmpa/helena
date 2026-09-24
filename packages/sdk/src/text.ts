// A label an extension shows to people. Built-in extensions point at a key of Helena's
// own translation files; a plugin brings its text along, one entry per locale it has
// (English is the fallback), or a single string for every locale.
export type LocalizedText = string | { i18n: string } | { [locale: string]: string };

export type Translate = (key: string) => string;

// The text for `locale`: the exact locale, then its language ("de" for "de-AT"), then
// English, then whatever the plugin has. An i18n key is looked up with `t` when the host
// passes one and returned as is otherwise.
export function resolveText(text: LocalizedText, locale: string, t?: Translate): string {
  if (typeof text === 'string') return text;
  if (typeof text.i18n === 'string' && Object.keys(text).length === 1) {
    return t ? t(text.i18n) : text.i18n;
  }
  const table = text as Record<string, string>;
  const language = locale.split('-')[0] ?? locale;
  return (
    table[locale] ??
    table[language] ??
    table.en ??
    Object.values(table).find((value) => typeof value === 'string') ??
    ''
  );
}
