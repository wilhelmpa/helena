import { db } from '@repo/db';
import { session } from '@repo/db/schema';
import { lt } from 'drizzle-orm';

// better-auth deletes an expired session only when that session is presented again, which a
// browser that lost its cookie never does: the rows stayed forever. The API's janitor loop
// removes them (apps/api background.ts), the password-less sign-ins' unused ones included
// (local-owner.ts). Returns how many it removed.
export async function pruneExpiredSessions(now = new Date()): Promise<number> {
  const removed = await db
    .delete(session)
    .where(lt(session.expiresAt, now))
    .returning({ id: session.id });
  return removed.length;
}
