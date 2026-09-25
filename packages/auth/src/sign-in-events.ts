import { lt } from 'drizzle-orm';
import { db } from '@repo/db';
import { helenaSignInEvent, type SignInMethod, type SignInOutcome } from '@repo/db/schema';

// The trail of the sign-ins Helena opens without a password (packages/db schema/sign-in.ts):
// the Cloudflare sign-in and the LAN owner sign-in. Shown in Administrator → Sicherheit.

export interface SignInEvent {
  method: SignInMethod;
  outcome: SignInOutcome;
  userId?: string | null;
  reason?: string | null;
  identity?: string | null;
  provider?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Half a year of sign-ins is kept; older rows go now and then, on a write.
const KEEP_MS = 183 * 24 * 3600_000;
const PRUNE_EVERY = 100;

const bounded = (value: string | null | undefined, max: number) =>
  value ? value.slice(0, max) : null;

// True when the event was written. The Cloudflare sign-in opens no session it could not
// record; the LAN sign-in goes on without the row (it worked before the trail existed).
export async function recordSignIn(event: SignInEvent): Promise<boolean> {
  try {
    const [row] = await db
      .insert(helenaSignInEvent)
      .values({
        method: event.method,
        outcome: event.outcome,
        userId: event.userId ?? null,
        reason: bounded(event.reason, 40),
        identity: bounded(event.identity, 254),
        provider: bounded(event.provider, 40),
        ipAddress: bounded(event.ipAddress, 64),
        userAgent: bounded(event.userAgent, 300),
      })
      .returning({ id: helenaSignInEvent.id });
    if (row && row.id % PRUNE_EVERY === 0) {
      await db
        .delete(helenaSignInEvent)
        .where(lt(helenaSignInEvent.createdAt, new Date(Date.now() - KEEP_MS)));
    }
    return Boolean(row);
  } catch (error) {
    console.error('[auth] could not record a sign-in:', error);
    return false;
  }
}
