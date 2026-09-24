import { networkInterfaces } from 'node:os';

// Whether a client address is on the owner's home network, for the terminal's
// "no code on the LAN" rule. 127.0.0.0/8 and ::1 are deliberately not: the Cloudflare
// tunnel will reach nginx over loopback, so "no step-up" must never extend to it.
//
// IPv6 counts too (owner, 2026-09-24: Safari reached Kingston over the home network's
// global IPv6 and was asked for a code): link-local and unique-local addresses, and a
// global address in the same /64 as one of this machine's own, which only a device on
// the same link can hold (a spoofed one cannot complete the TCP handshake).
export function isLanAddress(ip: string, ownPrefixes: string[] = ownIpv6Prefixes()): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts as [number, number, number, number];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe[89ab][0-9a-f]:/i.test(ip)) return true;
  const prefix = ipv6Prefix64(ip);
  return prefix !== null && ownPrefixes.includes(prefix);
}

// The /64 network of an IPv6 address (its first four groups, normalised), or null.
export function ipv6Prefix64(ip: string): string | null {
  const address = (ip.split('%')[0] ?? '').toLowerCase();
  if (!address.includes(':') || address.includes('.')) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 2 ? fill < 1 : left.length !== 8) return null;
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':');
}

// The /64 networks of this machine's own global IPv6 addresses.
export function ownIpv6Prefixes(): string[] {
  const prefixes = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv6' || entry.internal || !entry.cidr?.endsWith('/64')) continue;
      if (/^fe[89ab][0-9a-f]:/i.test(entry.address)) continue;
      const prefix = ipv6Prefix64(entry.address);
      if (prefix) prefixes.add(prefix);
    }
  }
  return [...prefixes];
}
