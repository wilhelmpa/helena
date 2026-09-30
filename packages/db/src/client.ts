import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import * as schema from './schema';
import { observePostgresQueries, observeTransactionCallbacks } from './transaction-callbacks';
export { withSettledTransactionCallbacks } from './transaction-callbacks';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Check your .env (see .env.example at the monorepo root).',
  );
}

// One connection per process. postgres-js manages the pool internally.
export const databaseRuntimeName = `helena-${process.pid}-${randomUUID()}`;
const queryClient = postgres(connectionString, {
  prepare: false,
  connection: { application_name: databaseRuntimeName },
});

export const db = observeTransactionCallbacks(
  drizzle(observePostgresQueries(queryClient), { schema }),
);

export async function closeDatabase(): Promise<void> {
  await queryClient.end({ timeout: 1 });
}

// Postgres LISTEN on one channel, over a connection of its own that postgres-js
// re-establishes (and listens on again) after it drops. `onNotify` receives each
// NOTIFY's payload. Resolves once the LISTEN is in place.
export async function listen(channel: string, onNotify: (payload: string) => void) {
  const request = await queryClient.listen(channel, onNotify);
  return { unlisten: () => request.unlisten() };
}
