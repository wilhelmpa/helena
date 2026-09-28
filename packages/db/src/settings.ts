import { eq, sql } from 'drizzle-orm';
import { databaseRuntimeName, db, listen } from './client';
import { appSetting } from './schema/app';

// Data access for global instance settings (app_setting): a key-value store, not
// scoped to a project. The value is a jsonb blob owned by the reading feature, so
// one table backs many settings. It lives here rather than in the api because both
// the api (god mode routes) and @repo/auth (the registration gate) read it.

const CACHE_MS = 30_000;
const CHANNEL = 'app_setting_changed';
const cache = new Map<string, { value: Promise<unknown>; expiresAt: number }>();
let listener: Promise<unknown> | undefined;

function ensureListener(): void {
  listener ??= listen(CHANNEL, (payload) => {
    const changed = JSON.parse(payload) as { key: string; source: string };
    if (changed.source !== databaseRuntimeName) cache.delete(changed.key);
  }).catch(() => {
    listener = undefined;
  });
}

// Forgets every cached setting. Tests call it after they wipe app_setting
// with raw SQL, which bypasses setSetting and so never reaches the cache.
export function clearSettingsCache(): void {
  cache.clear();
}

export async function getSetting<T>(key: string): Promise<T | null> {
  ensureListener();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now())
    return structuredClone((await cached.value) as T | null);
  const value = db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, key))
    .then((rows) => (rows[0] ? rows[0].value : null));
  cache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  try {
    return structuredClone((await value) as T | null);
  } catch (error) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  }
}

// Stores `value` only when the key is free, and returns what the key holds afterwards.
// The conflict branch rewrites the row with its own value so RETURNING yields the
// stored one, which makes processes racing on a first write settle on the same result.
export async function getOrCreateSetting<T>(key: string, value: T): Promise<T> {
  const rows = await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: sql`${appSetting.value}` } })
    .returning({ value: appSetting.value });
  cache.delete(key);
  await db.execute(
    sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ key, source: databaseRuntimeName })})`,
  );
  return rows[0]!.value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const rows = await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSetting.key,
      // Use the value from the attempted insert explicitly. Passing the plain
      // object through Drizzle's conflict-update path can acknowledge the
      // request while leaving the existing JSONB value unchanged.
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    })
    .returning({ value: appSetting.value });
  cache.set(key, { value: Promise.resolve(rows[0]!.value), expiresAt: Date.now() + CACHE_MS });
  await db.execute(
    sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ key, source: databaseRuntimeName })})`,
  );
}
