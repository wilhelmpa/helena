import { getSessionFromHeaders } from '@repo/auth';
import { getSetting, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';
import {
  CLOUDFLARE_ACCESS,
  EdgeAccessError,
  edgeProvider,
  normalizeEmail,
  type EdgeAccessConfig,
  type EdgeIdentity,
  normalizeClientId,
  serviceTokenHint,
  type EdgeServiceToken,
} from './providers';
import { verifyLanAccess } from './lan';

// Both checked nginx entries set this header. The tunnel requires its edge assertion;
// strict LAN requires a cookie assertion plus the online public Access check. A request
// without the marker belongs to the older local/internal paths and is handled as before;
// a client that sets it itself only makes its own request stricter.
export const EDGE_ENTRY_HEADER = 'x-helena-entry';

export type EdgeEntry = 'tunnel' | 'lan';

// Unknown non-empty values take the tunnel path: none can avoid a check.
export function edgeEntry(headers: Headers): EdgeEntry | null {
  const value = headers.get(EDGE_ENTRY_HEADER);
  return value && value.trim() ? (value === 'lan' ? 'lan' : 'tunnel') : null;
}

// ── Settings (Administrator → Sicherheit → Zugang von außen) ────────────────────

const SETTINGS_KEY = 'edgeAccess';

export interface EdgeAccessSettings extends EdgeAccessConfig {
  // The Cloudflare sign-in: a valid Access assertion of an allowed identity opens a Helena
  // session for that account, without a second password (sign-in.ts). Off by default; it
  // needs the provider configured and an explicit list of allowed identities.
  signIn: boolean;
  // At home, the web app on the public name switches to the home network's own origin
  // (HELENA_HOME_URL) when that answers, so the LAN is used directly.
  homeAutoConnect: boolean;
  updatedAt: string | null;
}

function defaultSettings(): EdgeAccessSettings {
  return {
    provider: CLOUDFLARE_ACCESS,
    teamDomain: '',
    audiences: [],
    allowedEmails: [],
    serviceTokens: [],
    signIn: false,
    homeAutoConnect: true,
    updatedAt: null,
  };
}

// The settings are read on every tunnel request, so they are held for a few seconds.
const CACHE_MS = 10_000;
let cached: { at: number; value: EdgeAccessSettings } | null = null;

export async function getEdgeAccessSettings(): Promise<EdgeAccessSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const stored = await getSetting<Partial<EdgeAccessSettings>>(SETTINGS_KEY);
  const value = { ...defaultSettings(), ...(stored ?? {}) };
  cached = { at: Date.now(), value };
  return value;
}

export function resetEdgeAccessCacheForTests(): void {
  cached = null;
}

function uniqueList(values: string[] | undefined, normalize: (value: string) => string) {
  return [...new Set((values ?? []).map(normalize).filter(Boolean))];
}

export interface EdgeAccessPatch {
  provider?: string;
  teamDomain?: string;
  audiences?: string[];
  allowedEmails?: string[];
  signIn?: boolean;
  homeAutoConnect?: boolean;
  // Replaces the service tokens (full client ids); `removeServiceTokens` drops them by hint.
  serviceTokens?: { clientId: string; actsAs: string; label?: string }[];
  removeServiceTokens?: string[];
}

const CLIENT_ID = /^[a-f0-9]{32}$/;

function nextServiceTokens(
  patch: EdgeAccessPatch,
  current: EdgeServiceToken[],
): EdgeServiceToken[] {
  let tokens = patch.serviceTokens
    ? patch.serviceTokens.map((token) => ({
        clientId: normalizeClientId(token.clientId),
        actsAs: normalizeEmail(token.actsAs),
        label: (token.label ?? '').trim().slice(0, 64) || 'Service token',
      }))
    : (current ?? []);
  const remove = patch.removeServiceTokens ?? [];
  if (remove.length > 0) {
    tokens = tokens.filter((token) => !remove.includes(serviceTokenHint(token.clientId)));
  }
  return tokens;
}

// Saves the settings after the provider accepted them. Clearing the team domain and the
// audiences turns the tunnel entry off: every request that arrives there is refused.
export async function setEdgeAccessSettings(patch: EdgeAccessPatch): Promise<EdgeAccessSettings> {
  const current = await getEdgeAccessSettings();
  const next: EdgeAccessSettings = {
    provider: patch.provider ?? current.provider,
    teamDomain: (patch.teamDomain ?? current.teamDomain).trim().toLowerCase(),
    audiences: uniqueList(patch.audiences ?? current.audiences, (value) =>
      value.trim().toLowerCase(),
    ),
    allowedEmails: uniqueList(patch.allowedEmails ?? current.allowedEmails, normalizeEmail),
    signIn: patch.signIn ?? current.signIn,
    homeAutoConnect: patch.homeAutoConnect ?? current.homeAutoConnect,
    serviceTokens: nextServiceTokens(patch, current.serviceTokens ?? []),
    updatedAt: new Date().toISOString(),
  };
  const provider = edgeProvider(next.provider);
  if (!provider) throw new HttpError(400, `Unknown edge access provider: ${next.provider}`);
  const cleared = next.teamDomain === '' && next.audiences.length === 0;
  if (!cleared) {
    const problem = provider.validate(next);
    if (problem) throw new HttpError(400, problem);
  }
  if (next.allowedEmails.some((email) => !/^[^\s@]+@[^\s@]+$/.test(email))) {
    throw new HttpError(400, 'An allowed identity must be an email address');
  }
  const tokens = next.serviceTokens ?? [];
  if (tokens.length > 5) throw new HttpError(400, 'At most five service tokens');
  if (tokens.some((token) => !CLIENT_ID.test(token.clientId))) {
    throw new HttpError(400, 'A service token client id is 32 hexadecimal characters');
  }
  if (new Set(tokens.map((token) => serviceTokenHint(token.clientId))).size !== tokens.length) {
    throw new HttpError(400, 'Two service tokens share the same client id');
  }
  // A token only ever acts for a person the owner already admits by name.
  if (tokens.some((token) => !next.allowedEmails.includes(token.actsAs))) {
    throw new HttpError(400, 'A service token must act as an allowed identity');
  }
  // The Cloudflare sign-in opens a session for the verified identity: only with the
  // provider set up and the identities named here, never "whoever Access lets in".
  if (next.signIn && (cleared || next.allowedEmails.length === 0)) {
    throw new HttpError(
      400,
      'The Cloudflare sign-in needs the team domain, the audience and at least one allowed identity',
    );
  }
  await setSetting(SETTINGS_KEY, next);
  cached = { at: Date.now(), value: next };
  return next;
}

export function edgeAccessConfigured(settings: EdgeAccessSettings): boolean {
  const provider = edgeProvider(settings.provider);
  return Boolean(provider && provider.validate(settings) === null);
}

// Proves that a tunnel request passed the edge provider's login. Throws EdgeAccessError;
// an instance without a valid configuration refuses every tunnel request (fail closed).
export async function verifyEdgeRequest(headers: Headers): Promise<EdgeIdentity> {
  const settings = await getEdgeAccessSettings();
  const provider = edgeProvider(settings.provider);
  if (!provider || provider.validate(settings) !== null) {
    throw new EdgeAccessError(
      'not_configured',
      'Access from outside is not configured on this instance',
    );
  }
  return provider.verify(headers, settings);
}

// The API-wide guard throws the shared HTTP error when edge verification fails.
export async function edgeGuard(request: Request): Promise<null> {
  const entry = edgeEntry(request.headers);
  if (!entry) return null;
  let identity: EdgeIdentity | null = null;
  try {
    if (entry === 'lan') await verifyLanAccess(request.headers, verifyEdgeRequest);
    else identity = await verifyEdgeRequest(request.headers);
  } catch (error) {
    const code = error instanceof EdgeAccessError ? error.code : 'invalid_assertion';
    throw new HttpError(403, 'Access from outside needs the edge sign-in', `edge_${code}`);
  }
  // The tunnel entry binds the Helena session to the Access identity (family access,
  // item 11). The strict LAN entry keeps its two Access gates without that binding.
  if (
    identity &&
    request.headers.has('cookie') &&
    new URL(request.url).pathname !== '/api/auth/sign-out'
  ) {
    // An API-key header cannot disable the binding of an interactive cookie.
    // Verify only the cookie here; service requests without cookies stay independent.
    const cookieHeaders = new Headers(request.headers);
    cookieHeaders.delete('x-api-key');
    const session = await getSessionFromHeaders(cookieHeaders);
    if (session && normalizeEmail(session.user.email) !== identity.email) {
      throw new HttpError(
        401,
        'Sign in with the current Access identity',
        'edge_identity_mismatch',
      );
    }
  }
  return null;
}
