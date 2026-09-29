// At home, automatically the fast way (docs/helena-decisions/security-hardening.md §5): the
// app opened on the public name (through Cloudflare) checks whether the home network's own
// origin answers from this device, and if so continues there, on the same page. The home
// origin resolves to the LAN address; from anywhere else it does not answer (or not with
// Helena's certificate), and the app stays where it is.
//
// Never a loop: only an origin other than the home one ever switches, and the home origin
// never sends anyone back. A failed check is remembered for a while, so a device away from
// home does not ask on every page. `?remote=1` keeps this tab on the public name (to try the
// tunnel from home).

export const PROBE_TIMEOUT_MS = 1500;
// Away from home the check fails; the browser logs that failure itself, so it is not
// repeated on every page (an hour, then once more).
export const FAILURE_PAUSE_MS = 60 * 60_000;
export const FAILED_KEY = 'helena.homeAccess.failedUntil';
export const STAY_KEY = 'helena.homeAccess.stay';
export const STAY_PARAM = 'remote';

export interface ProbeContext {
  here: string;
  homeUrl: string | undefined;
  failedUntil: number | null;
  stay: boolean;
  now: number;
  // The page's path: a public share page is for other people, whose browsers must not be
  // asked for local network access.
  pathname?: string;
}

// Whether this page should ask the home origin at all.
export function shouldProbe({
  here,
  homeUrl,
  failedUntil,
  stay,
  now,
  pathname = '/',
}: ProbeContext): boolean {
  if (!homeUrl || stay) return false;
  if (pathname === '/share' || pathname.startsWith('/share/')) return false;
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return false;
  }
  if (home.protocol !== 'https:' || home.origin === here) return false;
  return !(failedUntil && failedUntil > now);
}

// Whether this page is served from the home network's own origin.
export function isHomeOrigin(here: string, homeUrl: string | undefined): boolean {
  if (!homeUrl) return false;
  try {
    return new URL(homeUrl).origin === here;
  } catch {
    return false;
  }
}

export function probeUrl(homeUrl: string): string {
  return new URL('/backend/edge/home/probe', homeUrl).toString();
}

// The same page on the home origin.
export function homeTarget(
  homeUrl: string,
  location: { pathname: string; search: string; hash: string },
) {
  const params = new URLSearchParams(location.search);
  params.delete(STAY_PARAM);
  const search = params.toString();
  return new URL(
    `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
    homeUrl,
  ).toString();
}

// The probe's answer means "this is the home origin, reached from home" only when it is
// Helena's own answer for that name.
export function isHomeAnswer(body: unknown, homeUrl: string): boolean {
  if (!body || typeof body !== 'object') return false;
  const answer = body as { home?: unknown; host?: unknown };
  return answer.home === true && answer.host === new URL(homeUrl).host;
}
