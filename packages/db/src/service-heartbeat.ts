import { sql } from 'drizzle-orm';
import { db } from './client';
import { serviceHeartbeat } from './schema/app';

// Records one check of a Volition service for the health overview: null `error` for a
// service seen working, which moves `lastSeenAt`; the reason otherwise, which keeps it.
// The api and the worker both write checks, which is why this is here.
export async function recordServiceCheck(service: string, error: string | null): Promise<void> {
  const seen = error === null ? sql`now()` : null;
  await db
    .insert(serviceHeartbeat)
    .values({ service, lastSeenAt: seen, error })
    .onConflictDoUpdate({
      target: serviceHeartbeat.service,
      set: {
        checkedAt: sql`now()`,
        error: sql`excluded.error`,
        lastSeenAt: sql`coalesce(excluded.last_seen_at, ${serviceHeartbeat.lastSeenAt})`,
      },
    });
}
