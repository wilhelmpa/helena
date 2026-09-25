import { IntlMessageFormat } from 'intl-messageformat';
import ar from '../messages/ar/push.json';
import de from '../messages/de/push.json';
import en from '../messages/en/push.json';
import esES from '../messages/es-ES/push.json';
import fr from '../messages/fr/push.json';
import id from '../messages/id/push.json';
import ptBR from '../messages/pt-BR/push.json';
import ru from '../messages/ru/push.json';
import uk from '../messages/uk/push.json';
import zhCN from '../messages/zh-CN/push.json';
import { DEFAULT_LOCALE, toLocale, type Locale } from './index';

// The texts of Helena's push messages (docs/helena-decisions/push.md). They are written on
// the server, where no browser translates them, in the language of the device they go to.
// Translation files like the web's (messages/<locale>/push.json, English the source), in
// ICU MessageFormat so plurals follow each language's rules.

export type PushMessages = typeof en;

const CATALOG: Record<Locale, unknown> = {
  en,
  de,
  fr,
  'es-ES': esES,
  'pt-BR': ptBR,
  id,
  ru,
  uk,
  'zh-CN': zhCN,
  ar,
};

function lookup(table: unknown, key: string): string | null {
  let node: unknown = table;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

const formats = new Map<string, IntlMessageFormat>();

// The message `key` (`alert.emergencies.open`) in `locale`, with its values filled in.
// English where the language lacks it; the key itself where no language has it, so a
// missing text shows as a key rather than as nothing.
export function formatPush(
  locale: string,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const lang = toLocale(locale);
  const own = lookup(CATALOG[lang], key);
  const found = own !== null ? lang : DEFAULT_LOCALE;
  const message = own ?? lookup(CATALOG[DEFAULT_LOCALE], key);
  if (message === null) return key;
  const cacheKey = `${found}\0${key}`;
  let format = formats.get(cacheKey);
  if (!format) {
    format = new IntlMessageFormat(message, found);
    formats.set(cacheKey, format);
  }
  try {
    const out = format.format(values);
    return typeof out === 'string' ? out : String(out);
  } catch {
    // A value the message needs is missing: the message without it beats no message.
    return message;
  }
}

// Whether the message exists in English (the source every other language falls back to).
export function hasPushMessage(key: string): boolean {
  return lookup(CATALOG[DEFAULT_LOCALE], key) !== null;
}

// A duration in words, "3 Stunden", rounded to what a person reads on a phone: minutes
// below an hour, hours below two days, then days.
export function formatPushDuration(locale: string, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return formatPush(locale, 'duration.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return formatPush(locale, 'duration.hours', { count: hours });
  return formatPush(locale, 'duration.days', { count: Math.round(hours / 24) });
}
