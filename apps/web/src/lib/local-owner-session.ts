import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

export async function localOwnerSession(request: NextRequest): Promise<NextResponse | null> {
  const token = process.env.LOCAL_SINGLE_USER_TOKEN;
  const supplied = request.headers.get('x-volition-local-access');
  const origin = process.env.LOCAL_SINGLE_USER_ORIGIN;
  const endpoint = process.env.LOCAL_SINGLE_USER_API_URL;
  if (!token || token.length < 32 || !supplied || !origin || !endpoint) return null;
  if (
    Buffer.byteLength(token) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))
  )
    return null;
  if (request.headers.get('host') !== new URL(origin).host) return null;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return null;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== origin) return null;
  if (request.method !== 'GET') return null;

  try {
    const session = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-volition-local-access': token, origin },
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
