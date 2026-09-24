import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './index';

function isLanguageTag(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

// The interface language for a browser's Accept-Language header: negotiator reads the
// header (quality values, order), @formatjs/intl-localematcher picks the closest shipped
// language with CLDR's matching data ("de-AT" → de, "pt" → pt-BR, "es-MX" → es-ES).
// Languages listed after a wildcard are ones the browser likes less than "anything", so
// the default wins over them.
export function localeFromAcceptLanguage(value: string | null): Locale {
  const languages = new Negotiator({ headers: { 'accept-language': value ?? '' } }).languages();
  const wildcard = languages.indexOf('*');
  const requested = (wildcard === -1 ? languages : languages.slice(0, wildcard)).filter(
    isLanguageTag,
  );
  if (requested.length === 0) return DEFAULT_LOCALE;
  return match(requested, LOCALES, DEFAULT_LOCALE) as Locale;
}
