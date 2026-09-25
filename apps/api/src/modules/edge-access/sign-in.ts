import { desc, eq } from 'drizzle-orm';
import { EdgeSignInRefused, setEdgeSignInVerifier, trustedOrigins } from '@repo/auth';
import { db } from '@repo/db';
import { helenaSignInEvent, user } from '@repo/db/schema';
import { EdgeAccessError } from './providers';
import { getEdgeAccessSettings, verifyEdgeRequest } from './service';

// The Cloudflare sign-in's check (packages/auth edge-sign-in.ts asks it): the owner turned
// the sign-in on, the edge provider signed the request (verifyEdgeRequest: signature,
// audience, issuer, expiry, and the allow list when one is set), and the identity is on the
// explicit allow list, which the sign-in requires. The entry's proof and the account are
// checked by the endpoint itself. docs/helena-decisions/security-hardening.md §4.8.
export async function verifyEdgeSignIn(headers: Headers) {
  const settings = await getEdgeAccessSettings();
  if (!settings.signIn) {
    throw new EdgeSignInRefused('disabled', 'The Cloudflare sign-in is off');
  }
  let identity;
  try {
    identity = await verifyEdgeRequest(headers);
  } catch (error) {
    if (error instanceof EdgeAccessError) {
      throw new EdgeSignInRefused(error.code, error.message);
    }
    throw error;
  }
  if (!identity.email || !settings.allowedEmails.includes(identity.email)) {
    throw new EdgeSignInRefused('identity_not_allowed', 'This identity may not sign in here');
  }
  return {
    provider: identity.provider,
    email: identity.email,
    expiresAt: identity.expiresAt ? new Date(identity.expiresAt) : null,
  };
}

setEdgeSignInVerifier(verifyEdgeSignIn);

// ── The home network's own origin (HELENA_HOME_URL) ──────────────────────────────────────

// The origin the home network reaches Helena on directly (cloudflare/lan_https.py), when it
// is one of the instance's origins; null otherwise.
export function homeUrl(env = process.env): string | null {
  const value = env.HELENA_HOME_URL?.trim().replace(/\/+$/, '');
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && trustedOrigins.includes(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}

export async function homeConfig() {
  const settings = await getEdgeAccessSettings();
  const url = homeUrl();
  return { homeUrl: url, autoConnect: Boolean(url) && settings.homeAutoConnect };
}

// ── The trail (Administrator → Sicherheit) ───────────────────────────────────────────────

export async function listSignInEvents(limit = 20, method?: 'edge' | 'local_owner') {
  const rows = await db
    .select({
      id: helenaSignInEvent.id,
      method: helenaSignInEvent.method,
      outcome: helenaSignInEvent.outcome,
      reason: helenaSignInEvent.reason,
      identity: helenaSignInEvent.identity,
      provider: helenaSignInEvent.provider,
      ipAddress: helenaSignInEvent.ipAddress,
      userAgent: helenaSignInEvent.userAgent,
      userName: user.name,
      createdAt: helenaSignInEvent.createdAt,
    })
    .from(helenaSignInEvent)
    .leftJoin(user, eq(user.id, helenaSignInEvent.userId))
    .where(method ? eq(helenaSignInEvent.method, method) : undefined)
    .orderBy(desc(helenaSignInEvent.createdAt), desc(helenaSignInEvent.id))
    .limit(Math.max(1, Math.min(limit, 100)));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
