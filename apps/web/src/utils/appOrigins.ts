// The origins one Helena instance answers on (APP_URL, comma separated; the first is the
// primary one): the public name through the tunnel and the home network's own name, served
// by nginx on the LAN directly (docs/helena-decisions/security-hardening.md §5). The app is
// the same on each; only the addresses it hands the browser follow the origin the page was
// opened on, so the API, the tools and their websockets stay on that origin (the session
// cookie is host-only, per origin).

export function parseOrigins(value: string | undefined): string[] {
  const origins: string[] = [];
  for (const entry of (value ?? '').split(',')) {
    try {
      const url = new URL(entry.trim());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !origins.includes(url.origin))
        origins.push(url.origin);
    } catch {
      continue;
    }
  }
  return origins;
}

// The origin of a request as the proxy in front of the web app saw it (nginx passes Host and
// X-Forwarded-Proto), when it is one of the instance's origins; null for anything else.
export function requestOrigin(
  headers: Headers,
  origins: string[],
  fallbackProtocol = 'http:',
): string | null {
  const host = headers.get('host');
  if (!host) return null;
  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || fallbackProtocol.replace(/:$/, '');
  try {
    const url = new URL(`${proto}://${host}`);
    if (origins.includes(url.origin)) return url.origin;
    // nginx's $host carries no port: a Host without one names the instance origin with that
    // scheme and name, when there is exactly one.
    if (url.port || host.includes(':')) return null;
    const named = origins.filter((origin) => {
      const candidate = new URL(origin);
      return candidate.protocol === url.protocol && candidate.hostname === url.hostname;
    });
    return named.length === 1 ? named[0]! : null;
  } catch {
    return null;
  }
}

// An address on one of the instance's origins, moved to `target` (another of them): path,
// query and fragment stay. Anything else (another site, a relative value) is left alone.
export function rebaseUrl(value: string, origins: string[], target: string | null): string {
  if (!value || !target) return value;
  try {
    const url = new URL(value);
    if (url.origin === target || !origins.includes(url.origin)) return value;
    const moved = new URL(url.pathname + url.search + url.hash, target);
    // A bare origin stays bare ("https://a" → "https://b", not "https://b/").
    return value.endsWith('/') || url.pathname !== '/' || url.search || url.hash
      ? moved.toString()
      : moved.origin;
  } catch {
    return value;
  }
}
