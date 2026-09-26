// The domain the session cookie is set for. Host-only (undefined) unless the web app and the
// api really live on different hosts and so need a cookie both can read.
//
// A single-origin install (Helena behind nginx: the app at https://helena.example.com and the
// api under /backend on the same host) must never widen the cookie to the parent domain:
// ".example.com" would hand the session to every other site of that domain (the company's
// web site, its shop, any SaaS on a subdomain). docs/helena-decisions/security-hardening.md H-10.

// Parent domain for a cross-subdomain session cookie (".example.com" from
// "app.example.com"). Undefined for localhost, IPs, or apex domains, where no
// cross-subdomain sharing is possible.
export function parentDomain(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return undefined;
  }
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return undefined;
  const labels = host.split('.');
  if (labels.length < 3) return undefined;
  return '.' + labels.slice(1).join('.');
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

// Explicit COOKIE_DOMAIN wins ("host-only" or a domain, for multi-label TLDs or deep
// subdomains). Otherwise the parent domain only when the app and the api hosts differ.
export function sessionCookieDomain(
  appOrigin: string | undefined,
  apiUrl: string | undefined,
  configured: string | undefined,
): string | undefined {
  if (configured === 'host-only') return undefined;
  if (configured) return configured;
  const appHost = hostOf(appOrigin);
  const apiHost = hostOf(apiUrl);
  if (!appHost || !apiHost || appHost === apiHost) return undefined;
  return parentDomain(appOrigin);
}
