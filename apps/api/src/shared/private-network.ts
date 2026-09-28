import { trustedOrigins } from '@repo/auth';

// Chrome's Private Network Access: a page on a public origin (https://helena.volition.one,
// through the tunnel) that asks a private address (the home name, served by nginx on the LAN)
// first sends a preflight with `Access-Control-Request-Private-Network: true`, and goes on only
// when the answer says `Access-Control-Allow-Private-Network: true`. The web app's home probe
// (features/home-access) is such a request. The allowance is given to Helena's own origins
// (APP_URL) only, the same list the CORS answer trusts; a foreign page gets no such answer.
export function privateNetworkPreflightAllowed(
  request: Request,
  ownOrigins: readonly string[] = trustedOrigins,
): boolean {
  if (request.method.toUpperCase() !== 'OPTIONS') return false;
  const asked = request.headers.get('access-control-request-private-network');
  if (asked?.trim().toLowerCase() !== 'true') return false;
  const origin = request.headers.get('origin')?.trim();
  return !!origin && ownOrigins.includes(origin);
}
