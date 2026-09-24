import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { isPrivateIp } from '@repo/net';

// Same normalization the settings API uses (apps/api/src/modules/agent-browser-gateway/
// service.ts) — duplicated on purpose, not imported: this package runs inside the browser
// router process (a different deployment unit from the API), and the two copies are small
// enough that keeping them independent is clearer than a cross-process-boundary import.

export function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return null;
  if (isIP(host)) return host;
  return domainToASCII(host) || null;
}

export interface DomainPolicy {
  domainBlocklist: string[];
  domainAllowlist: string[];
  // Local and private addresses (the project setting "Lokale Adressen erlauben"): closed
  // unless the owner opened them.
  allowLocalAddresses?: boolean;
}

// A host that is local by its name or its literal address: localhost, the names a LAN
// resolves itself (*.local, *.lan, *.internal, *.home.arpa) and private, loopback,
// link-local and CGNAT addresses (@repo/net's ranges). The browser runs on the server, so
// such an address reaches Helena, the other projects' browsers and their DevTools ports.
export function isLocalHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (isIP(normalized)) return isPrivateIp(normalized);
  return (
    normalized === 'localhost' ||
    ['.localhost', '.local', '.lan', '.internal', '.home.arpa'].some((suffix) =>
      normalized.endsWith(suffix),
    )
  );
}

export type HostLookup = (host: string) => Promise<{ address: string }[]>;

const systemLookup: HostLookup = (host) => lookup(host, { all: true });

// Whether a host an agent names is local, its name resolved as well: a public-looking name
// pointing at a private address counts too. A name that does not resolve is left to the
// browser, which cannot open it either.
export async function resolvesLocally(
  host: string,
  resolve: HostLookup = systemLookup,
): Promise<boolean> {
  if (isLocalHost(host)) return true;
  const normalized = normalizeHost(host);
  if (!normalized || isIP(normalized)) return false;
  try {
    const addresses = await resolve(normalized);
    return addresses.some((entry) => isPrivateIp(entry.address));
  } catch {
    return false;
  }
}

// Whether navigation to `host` is allowed under the project's settings (design §8): the
// blocklist always applies; a non-empty allowlist is exclusive on top of that. Checked
// before every browser_navigate and before following a redirect or opening a new tab
// (design §7 does not name this explicitly, but §8's "Domain-Sperrliste... z. B. Banking
// gesperrt" only holds if it applies everywhere navigation can happen, not just the first
// call).
export function hostAllowed(policy: DomainPolicy, host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  const covers = (list: string[]) =>
    list.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
  if (covers(policy.domainBlocklist)) return false;
  if (policy.domainAllowlist.length > 0 && !covers(policy.domainAllowlist)) return false;
  if (!policy.allowLocalAddresses && isLocalHost(normalized)) return false;
  return true;
}

export function originAllowed(policy: DomainPolicy, urlString: string): boolean {
  try {
    return hostAllowed(policy, new URL(urlString).hostname);
  } catch {
    return false;
  }
}
