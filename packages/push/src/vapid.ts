import { asc, eq } from 'drizzle-orm';
import {
  db,
  helenaPushSubscription,
  insertSecretIfAbsent,
  readRedactedSecret,
  readSecret,
  user,
  writeSecret,
} from '@repo/db';
import { generateVapidKeys, type VapidKeys } from './keys';

export { generateVapidKeys, type VapidKeys };

// The instance's VAPID key pair (RFC 8292): the browser subscribes with the public key
// (applicationServerKey), and every push carries a JWT signed with the private key, which
// the push service checks against it. Generated once, on first use, and kept encrypted in
// app_secret like every other secret; the public half is mirrored in the row's redacted
// part so the settings page reads it without decrypting. The private key is never logged
// and never leaves the api and the worker.
//
// A new key pair would orphan every subscription (the push services refuse a JWT of another
// key), so there is no rotation on a schedule: `rotateVapidKeys` exists for a leaked key,
// and the app subscribes anew when it sees the key changed.

export const VAPID_SECRET_KEY = 'push.vapid';

interface StoredVapid {
  // P-256 public key, uncompressed point (65 bytes), base64url.
  publicKey: string;
  // The private scalar (JWK `d`), base64url.
  privateKey: string;
  createdAt: string;
}

interface RedactedVapid {
  publicKey: string;
  createdAt: string;
}

const CACHE_MS = 5 * 60_000;
let cached: { at: number; keys: VapidKeys } | null = null;
let subject: { at: number; value: string } | null = null;

// The public key browsers subscribe with; created with its private half on first call.
export async function vapidPublicKey(): Promise<string> {
  const redacted = await readRedactedSecret<RedactedVapid>(VAPID_SECRET_KEY);
  if (redacted?.publicKey) return redacted.publicKey;
  return (await vapidKeys()).publicKey;
}

// Both halves, for signing a push. Created on first call: two processes that race store
// one pair, and the loser reads the winner's back.
export async function vapidKeys(): Promise<VapidKeys> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.keys;
  let stored = await readSecret<StoredVapid>(VAPID_SECRET_KEY);
  if (!stored) {
    const fresh = await generateVapidKeys();
    const createdAt = new Date().toISOString();
    await insertSecretIfAbsent(
      VAPID_SECRET_KEY,
      { ...fresh, createdAt } satisfies StoredVapid,
      { publicKey: fresh.publicKey, createdAt } satisfies RedactedVapid,
    );
    stored = await readSecret<StoredVapid>(VAPID_SECRET_KEY);
    if (!stored) throw new Error('The VAPID keys could not be stored');
  }
  const keys = { publicKey: stored.publicKey, privateKey: stored.privateKey };
  cached = { at: Date.now(), keys };
  return keys;
}

// Forgets the cached pair (a test, or after a rotation in another process).
export function forgetVapidKeys(): void {
  cached = null;
  subject = null;
}

// Replaces the pair (a leaked private key) and removes every subscription, which only the
// old pair could push to. Each device subscribes anew the next time its Helena opens with
// push switched on. Returns how many subscriptions were removed.
export async function rotateVapidKeys(): Promise<number> {
  const fresh = await generateVapidKeys();
  const createdAt = new Date().toISOString();
  await writeSecret(
    VAPID_SECRET_KEY,
    { ...fresh, createdAt } satisfies StoredVapid,
    { publicKey: fresh.publicKey, createdAt } satisfies RedactedVapid,
  );
  forgetVapidKeys();
  const removed = await db
    .delete(helenaPushSubscription)
    .returning({ id: helenaPushSubscription.id });
  return removed.length;
}

// The JWT's `sub` (RFC 8292 §2.1): how a push service reaches the operator. Apple refuses a
// push whose subject is neither a mailto: nor an https: URL. HELENA_PUSH_SUBJECT when set;
// else the app's public https origin; else the instance owner's address.

export async function vapidSubject(): Promise<string> {
  const configured = process.env.HELENA_PUSH_SUBJECT?.trim();
  if (configured && /^(mailto:|https:\/\/)/.test(configured)) return configured;
  if (subject && Date.now() - subject.at < CACHE_MS) return subject.value;
  let value: string | null = null;
  for (const entry of (process.env.APP_URL ?? '').split(',')) {
    try {
      const url = new URL(entry.trim());
      const local =
        url.hostname === 'localhost' ||
        url.hostname.endsWith('.local') ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.includes(':');
      if (url.protocol === 'https:' && !local) {
        value = url.origin;
        break;
      }
    } catch {
      // Not a URL; the next one.
    }
  }
  if (!value) {
    const [owner] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.role, 'god'))
      .orderBy(asc(user.createdAt))
      .limit(1);
    value = owner?.email ? `mailto:${owner.email}` : 'mailto:push@helena.invalid';
  }
  subject = { at: Date.now(), value };
  return value;
}
