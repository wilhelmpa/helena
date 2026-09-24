import { localeFromAcceptLanguage } from '@helena/locales/accept-language';

// The interface languages and the Accept-Language matcher are shared with the web app.
export { DEFAULT_LOCALE, LOCALES, isLocale, toLocale, type Locale } from '@helena/locales';
export { localeFromAcceptLanguage };

// The interface language a request's browser prefers, which stands in for an account's
// own choice until the person makes one.
export function browserLocale(request: Request) {
  return localeFromAcceptLanguage(request.headers.get('accept-language'));
}
