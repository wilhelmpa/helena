import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

// An edge access provider: the identity-aware proxy in front of Helena when it is reached
// from the internet (Cloudflare Access today; Tailscale Funnel, Pomerium or oauth2-proxy
// fit the same shape). nginx marks every request that came in through the tunnel entry
// (`X-Helena-Entry: tunnel`, see deployment/volition-stack/native/cloudflare/), and the api
// then asks the configured provider to prove the request passed the proxy's login. A
// request the proxy did not sign is refused, whatever session cookie it carries: this is
// the defence in depth behind the proxy's own policy, for the day that policy is changed
// by mistake or a second hostname is routed to the tunnel without it.
//
// Decision and alternatives: docs/helena-decisions/security-hardening.md §4. The shape is
// kept small so it can move into @helena/sdk as a registry once a second provider exists.

export interface EdgeIdentity {
  provider: string;
  // The person the proxy signed in (Cloudflare: the `email` claim). A service token has
  // none and carries its client id in `subject` instead.
  email: string | null;
  subject: string;
  expiresAt: string | null;
}

export class EdgeAccessError extends Error {
  constructor(
    readonly code:
      'not_configured' | 'missing_assertion' | 'invalid_assertion' | 'identity_not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'EdgeAccessError';
  }
}

export interface EdgeAccessConfig {
  provider: string;
  // Cloudflare Access: the team domain, `<team>.cloudflareaccess.com`.
  teamDomain: string;
  // The Application Audience (AUD) tags of the Access application(s) in front of Helena.
  audiences: string[];
  // Optional second gate at the origin: only these identities, whatever the Access policy
  // lets in. Empty = every identity the policy admits.
  allowedEmails: string[];
}

export interface EdgeProvider {
  id: string;
  // Validates the provider-specific part of the config; returns an error text or null.
  validate(config: EdgeAccessConfig): string | null;
  verify(headers: Headers, config: EdgeAccessConfig): Promise<EdgeIdentity>;
}

// Cloudflare Access puts a signed JWT on every request it lets through to the origin, in
// the `Cf-Access-Jwt-Assertion` header, signed with the team's rotating RS256 keys that
// are published at /cdn-cgi/access/certs. The team domain is restricted to Cloudflare's
// own suffix, so a changed setting can never point the key lookup at another host.
export const CLOUDFLARE_ACCESS = 'cloudflare-access';
const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUDIENCE = /^[a-f0-9]{64}$/;
export const CF_ASSERTION_HEADER = 'cf-access-jwt-assertion';

// Key sets per team domain. jose caches the fetched keys (and refetches on an unknown
// key id, with a cooldown), so a key rotation at Cloudflare needs no restart.
type KeyResolver = (teamDomain: string) => JWTVerifyGetKey;
const remoteKeySets = new Map<string, JWTVerifyGetKey>();
const remoteKeys: KeyResolver = (teamDomain) => {
  let keys = remoteKeySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    remoteKeySets.set(teamDomain, keys);
  }
  return keys;
};
let keyResolver: KeyResolver = remoteKeys;

// Tests hand in a local key set instead of the network one.
export function setEdgeKeyResolverForTests(resolver: KeyResolver | null): void {
  keyResolver = resolver ?? remoteKeys;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const cloudflareAccessProvider: EdgeProvider = {
  id: CLOUDFLARE_ACCESS,
  validate(config) {
    if (!TEAM_DOMAIN.test(config.teamDomain)) {
      return 'The team domain must look like <team>.cloudflareaccess.com';
    }
    if (config.audiences.length === 0) return 'At least one Application Audience (AUD) tag';
    if (!config.audiences.every((aud) => AUDIENCE.test(aud))) {
      return 'An Application Audience (AUD) tag is 64 hexadecimal characters';
    }
    return null;
  },
  async verify(headers, config) {
    const token = headers.get(CF_ASSERTION_HEADER);
    if (!token) {
      throw new EdgeAccessError('missing_assertion', 'The request did not pass Cloudflare Access');
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keyResolver(config.teamDomain), {
        issuer: `https://${config.teamDomain}`,
        audience: config.audiences,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub'],
        // The clock of this machine and Cloudflare's may differ a little.
        clockTolerance: 60,
      }));
    } catch {
      throw new EdgeAccessError('invalid_assertion', 'The Cloudflare Access assertion is invalid');
    }
    const email = typeof payload.email === 'string' ? normalizeEmail(payload.email) : null;
    const subject =
      typeof payload.sub === 'string' && payload.sub
        ? payload.sub
        : typeof payload.common_name === 'string'
          ? payload.common_name
          : '';
    if (config.allowedEmails.length > 0 && (!email || !config.allowedEmails.includes(email))) {
      throw new EdgeAccessError(
        'identity_not_allowed',
        'This identity is not allowed on this Helena instance',
      );
    }
    return {
      provider: CLOUDFLARE_ACCESS,
      email,
      subject,
      expiresAt:
        typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
    };
  },
};

const providers = new Map<string, EdgeProvider>([[CLOUDFLARE_ACCESS, cloudflareAccessProvider]]);

export function edgeProvider(id: string): EdgeProvider | null {
  return providers.get(id) ?? null;
}

export function edgeProviderIds(): string[] {
  return [...providers.keys()];
}
