// The languages the interface ships with, shared by the web app and the API (the
// Accept-Language matcher is the ./accept-language entry, server-side only). `en` is the
// source language: every key exists in the web's `messages/en.json`, and a missing
// translation falls back to it.
export const LOCALES = [
  'en',
  'uk',
  'ru',
  'zh-CN',
  'ar',
  'fr',
  'pt-BR',
  'id',
  'es-ES',
  'de',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

// The shipped language for a stored or requested value, English for anything else.
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
