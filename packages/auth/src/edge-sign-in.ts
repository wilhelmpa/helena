import { timingSafeEqual } from 'node:crypto';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { SignInEvent } from './sign-in-events';

// The trail is written through the database; loaded on use, so the checks here stay
// testable without one.
const recordSignIn = async (event: SignInEvent) =>
  (await import('./sign-in-events')).recordSignIn(event);

// The Cloudflare sign-in: a request that came in through the internet tunnel with a valid
// Cloudflare Access assertion for an allowed identity gets a Helena session for the account
// with that address, without a second password. Off unless the owner turns it on
// (Administrator → Sicherheit → Zugang von außen). Design and threat model:
// docs/helena-decisions/security-hardening.md §4.8.
//
// Three things must hold, each checked here:
//  1. The request passed nginx's tunnel entry: it carries the entry's proof, a random value
//     only that server block sends, and only to the web app (cloudflare/install.sh
//     entry-token). No LAN client and no local process can present an Access assertion as
//     its own sign-in, however it got one.
//  2. The assertion is valid for this instance: apps/api's edge-access module verifies it
//     (signature from the team's keys, audience, issuer, expiry) and that the sign-in is on
//     and the identity is on the explicit allow list. It registers itself as the verifier;
//     without it (a process that did not load the api) every attempt is refused.
//  3. The identity is an account that may sign in this way (an existing verified human account), active.
// The session lasts at most a day and never longer than the Access session behind it, and
// it is not extended on use: the next day, Access decides again.

export const EDGE_ENTRY_PROOF_HEADER = 'x-helena-edge-entry';

export function edgeEntryAuthorized(headers: Headers, env = process.env): boolean {
  const token = env.HELENA_EDGE_ENTRY_TOKEN;
  const supplied = headers.get(EDGE_ENTRY_PROOF_HEADER);
  return Boolean(
    token &&
    token.length >= 32 &&
    supplied &&
    Buffer.byteLength(token) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(supplied)),
  );
}

export type EdgeSignInReason =
  | 'disabled'
  | 'not_configured'
  | 'missing_assertion'
  | 'invalid_assertion'
  | 'identity_not_allowed';

export class EdgeSignInRefused extends Error {
  constructor(
    readonly reason: EdgeSignInReason,
    message: string,
  ) {
    super(message);
    this.name = 'EdgeSignInRefused';
  }
}

export interface EdgeSignInIdentity {
  // The edge provider's id (`cloudflare-access`).
  provider: string;
  // The address the provider signed, normalised (lower case).
  email: string;
  // When the provider's own session ends, where it says.
  expiresAt: Date | null;
}

export type EdgeSignInVerifier = (headers: Headers) => Promise<EdgeSignInIdentity>;

let verifier: EdgeSignInVerifier | null = null;

// apps/api registers the edge-access check here when it loads (modules/edge-access).
export function setEdgeSignInVerifier(next: EdgeSignInVerifier | null): void {
  verifier = next;
}

// Who may sign in this way. Existing human accounts only; membership is never changed by signing in.
export const EDGE_SIGN_IN_ROLES: readonly string[] = ['god', 'user'];

// A session never outlives this, whatever the provider's session says.
export const EDGE_SESSION_MAX_MS = 24 * 3600_000;

// The provider's session end, within a day. An end that already passed (inside the clock
// tolerance the assertion was accepted with) gives a minute, not more.
export function edgeSessionExpiry(identity: EdgeSignInIdentity, now = Date.now()): Date {
  const cap = now + EDGE_SESSION_MAX_MS;
  const until = identity.expiresAt?.getTime();
  if (!until || Number.isNaN(until)) return new Date(cap);
  return new Date(Math.min(cap, Math.max(until, now + 60_000)));
}

export function edgeSignIn() {
  return {
    id: 'helena-edge-sign-in',
    endpoints: {
      signInEdge: createAuthEndpoint(
        '/sign-in/edge',
        {
          method: 'POST',
        },
        async (ctx) => {
          const headers = ctx.headers ?? new Headers();
          // Without the entry's proof the endpoint does not exist, like the LAN one. Such a
          // request is not written down: it names no identity, and a local process could
          // fill the table with them.
          if (!edgeEntryAuthorized(headers)) {
            throw new APIError('NOT_FOUND', { message: 'Not found' });
          }
          const client = {
            method: 'edge' as const,
            ipAddress: headers.get('x-real-ip'),
            userAgent: headers.get('user-agent'),
          };
          const refuse = async (
            reason: string,
            details: { identity?: string; provider?: string; userId?: string } = {},
          ): Promise<never> => {
            await recordSignIn({ ...client, ...details, outcome: 'refused', reason });
            throw new APIError('FORBIDDEN', {
              code: `EDGE_${reason.toUpperCase()}`,
              message: reason,
            });
          };

          if (!verifier) return refuse('not_configured');
          let identity: EdgeSignInIdentity;
          try {
            identity = await verifier(headers);
          } catch (error) {
            return refuse(error instanceof EdgeSignInRefused ? error.reason : 'invalid_assertion');
          }
          const named = { identity: identity.email, provider: identity.provider };
          const found = await ctx.context.internalAdapter.findUserByEmail(identity.email);
          if (!found) return refuse('no_account', named);
          const account = found.user as typeof found.user & { role?: string; active?: boolean };
          if (!account.role || !EDGE_SIGN_IN_ROLES.includes(account.role)) {
            return refuse('not_eligible', { ...named, userId: account.id });
          }
          const { isHumanAccount } = await import('./human-account');
          if (
            !(await isHumanAccount(account.id)) ||
            (account.role !== 'god' && !account.emailVerified)
          ) {
            return refuse('not_eligible', { ...named, userId: account.id });
          }
          if (account.active === false)
            return refuse('deactivated', { ...named, userId: account.id });

          // dontRememberMe: a browser-session cookie and no refresh on use (better-auth
          // extends only "remembered" sessions), with the expiry set explicitly.
          const session = await ctx.context.internalAdapter.createSession(
            account.id,
            true,
            { expiresAt: edgeSessionExpiry(identity) },
            true,
          );
          if (!session) throw new APIError('FORBIDDEN', { message: 'Session unavailable' });
          // No session without its record: the owner sees every one of them.
          const recorded = await recordSignIn({
            ...client,
            ...named,
            userId: account.id,
            outcome: 'ok',
          });
          if (!recorded) {
            await ctx.context.internalAdapter.deleteSession(session.token);
            throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Sign-in trail unavailable' });
          }
          await setSessionCookie(ctx, { session, user: found.user }, true);
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({ success: true });
        },
      ),
    },
  };
}
