import { HttpError } from './lib';
import { trustedOrigins } from '@repo/auth';

// Browsers say on every request where it comes from (Fetch Metadata, `Sec-Fetch-Site`). A
// request that changes something and comes from a page of another origin carries the owner's
// cookie along when that origin is on the same site: the session cookie is SameSite=Lax, and
// Lax lets same-site requests through. Such origins exist: the notes on the home name's
// second port (a note may hold script, and agents write notes), and any other name under the
// same domain. So a state-changing request marked `same-site` or `cross-site` that rides on a
// cookie is refused, unless its `Origin` is one of Helena's own (APP_URL: the web app may sit
// on another origin than the API, a development setup or a split deployment). This is the
// Fetch Metadata defence of OWASP's CSRF cheat sheet. Requests without the header (servers,
// agents, webhooks, the CLI) and requests without a cookie (an API key is not sent by a
// browser on its own) are left alone. docs/helena-decisions/notes-silverbullet.md §3.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function crossSiteRefusal(
  request: Request,
  ownOrigins: readonly string[] = trustedOrigins,
): null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (site !== 'same-site' && site !== 'cross-site') return null;
  if (!request.headers.has('cookie')) return null;
  const origin = request.headers.get('origin')?.trim();
  if (origin && ownOrigins.includes(origin)) return null;
  throw new HttpError(
    403,
    'A page of another origin may not change anything here',
    'cross_site_refused',
  );
}
