import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

// What the two password-less sign-ins of the proxy share (lib/local-owner-session.ts at home,
// lib/edge-sign-in-session.ts through the tunnel): the capability check, the call to the
// API's sign-in endpoint on loopback, and the redirect that hands the new session cookie to
// the browser and lands on the page it asked for.

export function sameSecret(expected: string | undefined, supplied: string | null): boolean {
  return Boolean(
    expected &&
    expected.length >= 32 &&
    supplied &&
    Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
  );
}

// A page load in this browser: not a cross-site request, not a request from another origin,
// a GET, and the page itself rather than a prefetch or a fetch the page makes. Each of those
// would sign in on its own before the first cookie arrived, and every sign-in is a session
// (a browser without a cookie fired several at once). A client that names no destination
// (curl, an older browser) still counts as a page load.
export function ownNavigation(request: NextRequest, origin: string): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== origin) return false;
  const destination = request.headers.get('sec-fetch-dest');
  if (destination && destination !== 'document') return false;
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
  if (purpose.includes('prefetch')) return false;
  if (request.headers.has('rsc') || request.headers.has('next-router-prefetch')) return false;
  return request.method === 'GET';
}

// The client as nginx saw it, and its browser, for the session row and the sign-in trail.
export function clientHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const address = request.headers.get('x-real-ip');
  const agent = request.headers.get('user-agent');
  if (address) headers['x-real-ip'] = address;
  if (agent) headers['user-agent'] = agent.slice(0, 300);
  return headers;
}

// Calls the API's sign-in endpoint and, when it opened a session, answers the browser with a
// redirect that carries the session cookie to the page it asked for (a sign-in page leads to
// its callback, or home). Null when there is no session to hand over.
export async function signInRedirect(
  request: NextRequest,
  origin: string,
  endpoint: string,
  headers: Record<string, string>,
): Promise<NextResponse | null> {
  try {
    const session = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, origin },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const cookies = session.headers.getSetCookie();
    if (
      !session.ok ||
      !cookies.some(
        (cookie) =>
          cookie.startsWith('better-auth.session_token=') ||
          cookie.startsWith('__Secure-better-auth.session_token='),
      )
    )
      return null;
    const path = ['/login', '/register'].includes(request.nextUrl.pathname)
      ? request.nextUrl.searchParams.get('callbackURL') || '/'
      : request.nextUrl.pathname + request.nextUrl.search;
    const target = new URL(path, origin);
    const safeTarget =
      target.origin === origin && !['/login', '/register'].includes(target.pathname)
        ? target
        : new URL('/', origin);
    const response = NextResponse.redirect(safeTarget, 303);
    for (const cookie of cookies) response.headers.append('set-cookie', cookie);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return null;
  }
}
