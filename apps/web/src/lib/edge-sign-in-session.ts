import type { NextRequest, NextResponse } from 'next/server';
import { requestOrigin } from '@/utils/appOrigins';
import { appOrigins } from '@/utils/runtimeEnv';
import { clientHeaders, ownNavigation, sameSecret, signInRedirect } from './session-bootstrap';

// The Cloudflare sign-in (docs/helena-decisions/security-hardening.md §4.8): a page load
// without a session that came through the internet tunnel with a Cloudflare Access
// assertion asks the API to open a session for the identity Access signed. The API decides
// (the sign-in is on, the assertion is valid, the identity is allowed and is the owner);
// this only passes the request on when it carries the tunnel entry's proof, which nginx
// sends on the tunnel entry alone and only to this app (cloudflare/install.sh
// entry-token). A LAN client or a local process has no proof, whatever else it sends.
export async function edgeSignInSession(request: NextRequest): Promise<NextResponse | null> {
  const proof = process.env.HELENA_EDGE_ENTRY_TOKEN;
  const supplied = request.headers.get('x-helena-edge-entry');
  const assertion = request.headers.get('cf-access-jwt-assertion');
  if (!assertion || !sameSecret(proof, supplied)) return null;
  const origin = requestOrigin(request.headers, appOrigins(), 'https:');
  if (!origin || !ownNavigation(request, origin)) return null;
  const api = (process.env.SERVICE_URL_API || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  return signInRedirect(request, origin, `${api}/api/auth/sign-in/edge`, {
    'x-helena-edge-entry': proof!,
    // The API's edge guard verifies the assertion on every request marked like this, the
    // sign-in endpoint once more; the marker only ever makes a request stricter.
    'x-helena-entry': 'tunnel',
    'cf-access-jwt-assertion': assertion,
    ...clientHeaders(request),
  });
}
