import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

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
  return true;
}

export function originAllowed(policy: DomainPolicy, urlString: string): boolean {
  try {
    return hostAllowed(policy, new URL(urlString).hostname);
  } catch {
    return false;
  }
}
