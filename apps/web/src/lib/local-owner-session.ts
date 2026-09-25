import type { NextRequest, NextResponse } from 'next/server';
import { clientHeaders, ownNavigation, sameSecret, signInRedirect } from './session-bootstrap';

// The LAN owner sign-in (deployment/volition-stack/native/local-owner): nginx hands a request
// from the home network the capability, and a page load without a session gets one for the
// configured owner, on the LAN origin only.
export async function localOwnerSession(request: NextRequest): Promise<NextResponse | null> {
  const token = process.env.LOCAL_SINGLE_USER_TOKEN;
  const origin = process.env.LOCAL_SINGLE_USER_ORIGIN;
  const endpoint = process.env.LOCAL_SINGLE_USER_API_URL;
  if (!origin || !endpoint) return null;
  if (!sameSecret(token, request.headers.get('x-volition-local-access'))) return null;
  if (request.headers.get('host') !== new URL(origin).host) return null;
  if (!ownNavigation(request, origin)) return null;
  return signInRedirect(request, origin, endpoint, {
    'x-volition-local-access': token!,
    ...clientHeaders(request),
  });
}
