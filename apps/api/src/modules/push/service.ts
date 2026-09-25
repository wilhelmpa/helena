import { isIP } from 'node:net';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { toLocale } from '@helena/locales';
import { formatPush } from '@helena/locales/push';
import { db, helenaPushPresence, helenaPushSubscription } from '@repo/db';
import {
  forgetDevice,
  recordDeviceResult,
  sendWebPush,
  vapidPublicKey,
  wantsCategory,
} from '@helena/push';
import { isPrivateIp } from '@repo/net';
import { HttpError } from '#shared/lib';
import { categoriesFor } from './categories';
import { notificationSettingsPath } from './paths';

// A person's devices that receive Helena's pushes (Konto → Benachrichtigungen): subscribing,
// the categories each device wants, removing one, a test message, and whether the person is
// looking at Helena right now. Every call is scoped to the signed-in person.

const MAX_DEVICES = 20;
const PRESENCE_SECONDS = 90;

type DeviceRow = typeof helenaPushSubscription.$inferSelect;

export interface DeviceView {
  id: number;
  label: string;
  userAgent: string;
  locale: string;
  // The push service's host (fcm.googleapis.com, web.push.apple.com, …).
  service: string;
  endpoint: string;
  // Whether the device subscribed with the instance's current key; a device that did not
  // must subscribe again before it can receive anything.
  currentKey: boolean;
  // Every category this person may have, on or off on this device.
  categories: Record<string, boolean>;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function view(row: DeviceRow, owner: boolean, publicKey: string | null): DeviceView {
  const categories: Record<string, boolean> = {};
  for (const category of categoriesFor(owner)) {
    categories[category.id] = wantsCategory(row.categories, category.id, category.defaultOn);
  }
  let service = '';
  try {
    service = new URL(row.endpoint).hostname;
  } catch {
    service = '';
  }
  return {
    id: row.id,
    label: row.label,
    userAgent: row.userAgent,
    locale: row.locale,
    service,
    endpoint: row.endpoint,
    currentKey: publicKey !== null && row.vapidKey === publicKey,
    categories,
    createdAt: row.createdAt.toISOString(),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastFailureAt: iso(row.lastFailureAt),
    failureCount: row.failureCount,
    lastError: row.lastError,
  };
}

// The public VAPID key, or null where this instance cannot hold one (no encryption key).
export async function publicKeyOrNull(): Promise<string | null> {
  try {
    return await vapidPublicKey();
  } catch (error) {
    console.error('[push] no VAPID key:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function listDevices(userId: string, owner: boolean): Promise<DeviceView[]> {
  const publicKey = await publicKeyOrNull();
  const rows = await db
    .select()
    .from(helenaPushSubscription)
    .where(eq(helenaPushSubscription.userId, userId))
    .orderBy(asc(helenaPushSubscription.createdAt), asc(helenaPushSubscription.id));
  return rows.map((row) => view(row, owner, publicKey));
}

async function ownDevice(userId: string, id: number): Promise<DeviceRow> {
  const [row] = await db
    .select()
    .from(helenaPushSubscription)
    .where(and(eq(helenaPushSubscription.id, id), eq(helenaPushSubscription.userId, userId)));
  if (!row) throw new HttpError(404, 'Device not found');
  return row;
}

// ── Checking what a browser hands over ────────────────────────────────────────────────────

function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  return Buffer.from(value.replace(/=+$/, ''), 'base64url');
}

// An endpoint is a push service's https URL. The address it resolves to is checked again on
// every send (the SSRF guard in @repo/net); this refuses the obvious at once.
export function checkEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, 'The endpoint is not a URL', 'push_endpoint_invalid');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    (isIP(host) !== 0 && isPrivateIp(host))
  ) {
    throw new HttpError(400, 'The endpoint must be a public https URL', 'push_endpoint_invalid');
  }
}

export function checkKeys(p256dh: string, auth: string): void {
  const point = decode(p256dh);
  const secret = decode(auth);
  if (!point || point.length !== 65 || point[0] !== 0x04) {
    throw new HttpError(400, 'The device key is not a P-256 public key', 'push_key_invalid');
  }
  if (!secret || secret.length !== 16) {
    throw new HttpError(400, 'The auth secret must be 16 bytes', 'push_key_invalid');
  }
}

// The categories a request may set: known ones the person may have, as booleans.
function cleanCategories(
  given: Record<string, boolean> | undefined,
  owner: boolean,
): Record<string, boolean> {
  const allowed = new Set(categoriesFor(owner).map((category) => category.id));
  const out: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(given ?? {})) {
    if (allowed.has(id) && typeof on === 'boolean') out[id] = on;
  }
  return out;
}

export interface SubscribeInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  vapidKey: string;
  label?: string;
  locale?: string;
  categories?: Record<string, boolean>;
  // The endpoint this subscription replaces (the service worker's pushsubscriptionchange).
  replaces?: string;
}

// Stores this browser's subscription for the person. The same browser subscribing again
// updates its row (its categories stay unless the request names them); a browser another
// person subscribed on moves to whoever is signed in now.
export async function subscribe(
  userId: string,
  owner: boolean,
  input: SubscribeInput,
  userAgent: string,
): Promise<DeviceView> {
  checkEndpoint(input.endpoint);
  checkKeys(input.keys.p256dh, input.keys.auth);
  const publicKey = await vapidPublicKey();
  if (input.vapidKey !== publicKey) {
    throw new HttpError(409, 'The device subscribed with an old key', 'push_key_changed');
  }
  let label = (input.label ?? '').trim().slice(0, 80);
  const locale = toLocale(input.locale);
  const categories = cleanCategories(input.categories, owner);
  const expiresAt =
    typeof input.expirationTime === 'number' && Number.isFinite(input.expirationTime)
      ? new Date(input.expirationTime)
      : null;

  const row = await db.transaction(async (tx) => {
    if (input.replaces && input.replaces !== input.endpoint) {
      const [old] = await tx
        .select()
        .from(helenaPushSubscription)
        .where(
          and(
            eq(helenaPushSubscription.endpoint, input.replaces),
            eq(helenaPushSubscription.userId, userId),
          ),
        );
      if (old) {
        await tx.delete(helenaPushSubscription).where(eq(helenaPushSubscription.id, old.id));
        // The replacement keeps the old device's name and choices.
        if (!label) label = old.label;
        for (const [id, on] of Object.entries(old.categories)) categories[id] ??= on;
      }
    }
    const [existing] = await tx
      .select()
      .from(helenaPushSubscription)
      .where(eq(helenaPushSubscription.endpoint, input.endpoint));
    if (existing && existing.userId === userId) {
      const [updated] = await tx
        .update(helenaPushSubscription)
        .set({
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          vapidKey: publicKey,
          userAgent: userAgent.slice(0, 300),
          locale,
          expiresAt,
          ...(label ? { label } : {}),
          ...(input.categories ? { categories: { ...existing.categories, ...categories } } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(helenaPushSubscription.id, existing.id))
        .returning();
      return updated!;
    }
    if (existing) {
      await tx.delete(helenaPushSubscription).where(eq(helenaPushSubscription.id, existing.id));
    }
    const [{ n }] = await tx
      .select({ n: count() })
      .from(helenaPushSubscription)
      .where(eq(helenaPushSubscription.userId, userId));
    if (n >= MAX_DEVICES) {
      throw new HttpError(409, `At most ${MAX_DEVICES} devices`, 'push_too_many_devices');
    }
    const [created] = await tx
      .insert(helenaPushSubscription)
      .values({
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        vapidKey: publicKey,
        label,
        userAgent: userAgent.slice(0, 300),
        locale,
        categories,
        expiresAt,
      })
      .returning();
    return created!;
  });
  return view(row, owner, publicKey);
}

export async function updateDevice(
  userId: string,
  owner: boolean,
  id: number,
  patch: { label?: string; categories?: Record<string, boolean>; locale?: string },
): Promise<DeviceView> {
  const row = await ownDevice(userId, id);
  const [updated] = await db
    .update(helenaPushSubscription)
    .set({
      ...(patch.label !== undefined ? { label: patch.label.trim().slice(0, 80) } : {}),
      ...(patch.locale !== undefined ? { locale: toLocale(patch.locale) } : {}),
      ...(patch.categories
        ? { categories: { ...row.categories, ...cleanCategories(patch.categories, owner) } }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(helenaPushSubscription.id, id))
    .returning();
  return view(updated!, owner, await publicKeyOrNull());
}

export async function removeDevice(userId: string, id: number): Promise<void> {
  await ownDevice(userId, id);
  await forgetDevice(id);
}

export interface TestResult {
  ok: boolean;
  status: number | null;
  gone: boolean;
  error: string | null;
}

// Sends a test message to one device now, past its categories, and reports what the push
// service answered. A device the push service no longer knows is removed.
export async function sendTest(userId: string, id: number): Promise<TestResult> {
  const row = await ownDevice(userId, id);
  const result = await sendWebPush(row, {
    category: 'test',
    title: formatPush(row.locale, 'test.title'),
    body: formatPush(row.locale, 'test.body'),
    url: notificationSettingsPath(),
    tag: 'test',
    urgency: 'high',
    ttlSeconds: 300,
    at: new Date().toISOString(),
  });
  if (result.gone) await forgetDevice(id);
  else await recordDeviceResult(id, result, !result.ok);
  return {
    ok: result.ok,
    status: result.status ?? null,
    gone: result.gone === true,
    error: result.error ?? null,
  };
}

// A page of Helena is visible (or was just hidden) on one of the person's devices.
export async function setPresence(userId: string, visible: boolean): Promise<void> {
  const until = visible
    ? sql`now() + make_interval(secs => ${PRESENCE_SECONDS})`
    : sql`now() - interval '1 second'`;
  await db
    .insert(helenaPushPresence)
    .values({ userId, visibleUntil: until })
    .onConflictDoUpdate({ target: helenaPushPresence.userId, set: { visibleUntil: until } });
}
