import { getSetting, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';
import {
  CLOUDFLARE_ACCESS,
  EdgeAccessError,
  edgeProvider,
  normalizeEmail,
  type EdgeAccessConfig,
  type EdgeIdentity,
} from './providers';

// nginx's tunnel entry (the server block cloudflared connects to) sets this header on every
// request it forwards, and only that entry does. Its presence is what makes the api demand
// the edge provider's proof. A request without it is a LAN or local one and is handled as
// before; a request that sets it itself only ever makes itself stricter.
export const EDGE_ENTRY_HEADER = 'x-helena-entry';

export type EdgeEntry = 'tunnel';

// Any non-empty value counts as the tunnel: an unknown value is not a way around the check.
export function edgeEntry(headers: Headers): EdgeEntry | null {
  const value = headers.get(EDGE_ENTRY_HEADER);
  return value && value.trim() ? 'tunnel' : null;
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
  // The Cloudflare sign-in turns an Access login into the owner's session: only with the
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

// The api-wide guard (app.ts onRequest): null when the request may continue, otherwise the
// refusal to answer with.
export async function edgeGuard(request: Request): Promise<Response | null> {
  if (!edgeEntry(request.headers)) return null;
  try {
    await verifyEdgeRequest(request.headers);
    return null;
  } catch (error) {
    const code = error instanceof EdgeAccessError ? error.code : 'invalid_assertion';
    return Response.json(
      { error: 'Access from outside needs the edge sign-in', code: `edge_${code}` },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
