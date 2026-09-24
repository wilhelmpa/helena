import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { localeFromAcceptLanguage } from '@helena/locales/accept-language';
import { isTimeZone } from '@/utils/dates';
import { FALLBACK_TIMEZONE, LOCALE_COOKIE, TIMEZONE_COOKIE, isLocale } from './locales';
import { loadMessages } from './messages';

// The app has no `[locale]` route segment, so every URL stays the same in every
// language. The account preference is the durable copy, the cookie selects later
// server renders, and the browser preference selects the first render without one.
export default getRequestConfig(async () => {
  const jar = await cookies();
  const cookie = jar.get(LOCALE_COOKIE)?.value;
  // The zone dates are rendered in, on the server and in the browser alike: without one,
  // next-intl would format a server render in the server's zone and its hydration in the
  // browser's, and ignore the account setting.
  const zone = decodeURIComponent(jar.get(TIMEZONE_COOKIE)?.value ?? '');
  const locale = isLocale(cookie)
    ? cookie
    : localeFromAcceptLanguage((await headers()).get('accept-language'));

  return {
    locale,
    messages: await loadMessages(locale),
    // The initial reference for relative times. Sharing it between the server and
    // client keeps hydration stable; RelativeTimeProvider advances it once mounted.
    now: new Date(),
    timeZone: isTimeZone(zone) ? zone : FALLBACK_TIMEZONE,
  };
});
