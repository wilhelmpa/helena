import { Resolver } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList } from 'node:net';
import { EdgeAccessError } from './providers';

const PUBLIC_HOST = 'helena.volition.one';
const VERIFY_PATH = '/backend/auth/verify/edge';
const PUBLIC_RESOLVERS = ['1.1.1.1', '1.0.0.1'];
const TIMEOUT_MS = 3000;
const nonPublic = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  nonPublic.addSubnet(subnet, prefix);

// Parsing is deliberately stricter than a browser's cookie parser: nginx must never
// choose one assertion while the API verifies another one.
function lanAccessCookies(raw: string | null) {
  if (!raw || Buffer.byteLength(raw) > 8192) {
    throw new EdgeAccessError('invalid_assertion', 'Missing or oversized Access cookies');
  }
  const found = new Map<string, string>();
  for (const part of raw.split(';')) {
    const entry = part.trim();
    const separator = entry.indexOf('=');
    if (separator < 1) throw new EdgeAccessError('invalid_assertion', 'Malformed cookies');
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !/^[\x21-\x3A\x3C-\x7E]*$/.test(value)) {
      throw new EdgeAccessError('invalid_assertion', 'Malformed cookies');
    }
    const lower = name.toLowerCase();
    if (lower === 'cf_authorization' || lower === 'cf_binding') {
      if (found.has(lower)) {
        throw new EdgeAccessError('invalid_assertion', 'Ambiguous Access cookies');
      }
      found.set(lower, value);
    }
  }
  const assertion = found.get('cf_authorization') ?? '';
  const binding = found.get('cf_binding') ?? '';
  if (
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion) ||
    assertion.length > 4096 ||
    !binding ||
    binding.length > 4096
  ) {
    throw new EdgeAccessError('invalid_assertion', 'Access cookies are incomplete');
  }
  return {
    assertion,
    binding,
    onlineCookie: `CF_Authorization=${assertion}; CF_Binding=${binding}`,
  };
}

async function publicAddress(): Promise<string> {
  const resolver = new Resolver();
  resolver.setServers(PUBLIC_RESOLVERS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolver.resolve4(PUBLIC_HOST),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          resolver.cancel();
          reject(new Error('Public DNS timeout'));
        }, TIMEOUT_MS);
      }),
    ]);
    const address = addresses.find((value) => !nonPublic.check(value));
    if (!address) throw new Error('No public address');
    return address;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPublicAccess(cookie: string): Promise<boolean> {
  const address = await publicAddress();
  return new Promise<boolean>((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: PUBLIC_HOST,
        servername: PUBLIC_HOST,
        path: VERIFY_PATH,
        method: 'GET',
        lookup: (_host, _options, callback) => callback(null, address, 4),
        agent: false,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        timeout: TIMEOUT_MS,
        rejectUnauthorized: true,
        headers: { Host: PUBLIC_HOST, Cookie: cookie, Accept: '*/*', 'Cache-Control': 'no-store' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 204 && !response.headers.location);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Access check timeout')));
    request.on('error', reject);
    request.end();
  });
}

let onlineVerifier = verifyPublicAccess;
export function setLanOnlineVerifierForTests(value: typeof verifyPublicAccess | null): void {
  onlineVerifier = value ?? verifyPublicAccess;
}

export async function verifyLanAccess(
  headers: Headers,
  verifyAssertion: (headers: Headers) => Promise<unknown>,
): Promise<void> {
  const cookies = lanAccessCookies(headers.get('cookie'));
  // Ignore any client-supplied assertion: only the unambiguous application cookie counts.
  await verifyAssertion(new Headers({ 'cf-access-jwt-assertion': cookies.assertion }));
  try {
    if (await onlineVerifier(cookies.onlineCookie)) return;
  } catch {
    // DNS, TLS, timeout and upstream failures all fail closed.
  }
  throw new EdgeAccessError('invalid_assertion', 'Public Access check refused');
}
