import { and, eq, lt, sql } from 'drizzle-orm';
import { intEnv } from '@helena/loop';
import { db, helenaPushSubscription, notificationDelivery, type DeliveryPayload } from '@repo/db';
import { pushBackoffMs } from './backoff';
import { sendWebPush, type PushSendResult } from './send';

export { pushBackoffMs };

// Drains the push rows of the notification outbox (channel 'push'): claims the due ones,
// sends each to its device, and keeps the device's record (last success, failures) up to
// date. The same claim and retry pattern as the worker's email and Telegram drain; both the
// api and the worker run this one, so a push goes out while either of them is down. FOR
// UPDATE SKIP LOCKED keeps two drains off the same row, and the claim leases a row by
// pushing next_attempt_at forward, so a row whose process died mid-send is claimed again.
//
// A sent row is deleted (no delivery history is kept). A row whose device is gone is
// deleted with the device. A row that failed for good stays 'failed' with its last error
// for a week, then is pruned. A row older than its message's TTL is dropped unsent: an
// answer that arrives a day late is noise.

interface Claimed {
  id: number;
  recipient: string | null;
  payload: DeliveryPayload;
  attempts: number;
  createdAt: Date;
}

const FAILED_KEEP_DAYS = 7;
const PRUNE_EVERY_MS = 3_600_000;
let prunedAt = 0;

async function claim(): Promise<Claimed[]> {
  const batch = intEnv('HELENA_PUSH_BATCH_SIZE', 20);
  const lease = intEnv('HELENA_PUSH_LEASE_SECONDS', 120);
  const rows = await db.execute(sql`
    UPDATE notification_delivery d
    SET attempts = d.attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${lease})
    WHERE d.id IN (
      SELECT id FROM notification_delivery
      WHERE channel = 'push' AND status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    )
    RETURNING d.id, d.recipient, d.payload, d.attempts, d.created_at AS "createdAt"
  `);
  return (rows as unknown as Claimed[]).map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
  }));
}

async function removeRow(id: number): Promise<void> {
  await db.delete(notificationDelivery).where(eq(notificationDelivery.id, id));
}

// A device the push service no longer knows: removed, with every message still waiting
// for it.
export async function forgetDevice(subscriptionId: number): Promise<void> {
  await db.delete(helenaPushSubscription).where(eq(helenaPushSubscription.id, subscriptionId));
  await db
    .delete(notificationDelivery)
    .where(
      and(
        eq(notificationDelivery.channel, 'push'),
        eq(notificationDelivery.recipient, String(subscriptionId)),
      ),
    );
}

// Records a send on the device: a success clears its failures, a failure notes the push
// service's answer. `final`: the message is given up on (counts as a failure of the device).
export async function recordDeviceResult(
  subscriptionId: number,
  result: PushSendResult,
  final: boolean,
): Promise<void> {
  if (result.ok) {
    await db
      .update(helenaPushSubscription)
      .set({ lastSuccessAt: sql`now()`, failureCount: 0, lastError: null })
      .where(eq(helenaPushSubscription.id, subscriptionId));
    return;
  }
  await db
    .update(helenaPushSubscription)
    .set({
      lastFailureAt: sql`now()`,
      lastError: (result.error ?? 'push failed').slice(0, 300),
      ...(final ? { failureCount: sql`${helenaPushSubscription.failureCount} + 1` } : {}),
    })
    .where(eq(helenaPushSubscription.id, subscriptionId));
}

async function handle(row: Claimed): Promise<void> {
  const message = row.payload.push;
  const subscriptionId = Number(row.recipient);
  if (!message || !Number.isInteger(subscriptionId)) {
    await db
      .update(notificationDelivery)
      .set({ status: 'failed', lastError: 'not a push message' })
      .where(eq(notificationDelivery.id, row.id));
    return;
  }
  if (Date.now() - row.createdAt.getTime() > message.ttlSeconds * 1000) {
    await removeRow(row.id);
    return;
  }
  const [device] = await db
    .select({
      endpoint: helenaPushSubscription.endpoint,
      p256dh: helenaPushSubscription.p256dh,
      auth: helenaPushSubscription.auth,
    })
    .from(helenaPushSubscription)
    .where(eq(helenaPushSubscription.id, subscriptionId));
  if (!device) {
    // The person removed the device while the message waited.
    await removeRow(row.id);
    return;
  }

  let result: PushSendResult;
  try {
    result = await sendWebPush(device, message);
  } catch (error) {
    result = {
      ok: false,
      retryable: true,
      error: error instanceof Error ? error.message : 'push failed',
    };
  }

  if (result.ok) {
    await removeRow(row.id);
    await recordDeviceResult(subscriptionId, result, false);
    return;
  }
  if (result.gone) {
    await forgetDevice(subscriptionId);
    return;
  }
  const maxAttempts = intEnv('HELENA_PUSH_MAX_ATTEMPTS', 5);
  const error = (result.error ?? 'push failed').slice(0, 500);
  if (result.retryable && row.attempts < maxAttempts) {
    const delay = Math.ceil((result.retryAfterMs ?? pushBackoffMs(row.attempts)) / 1000);
    await db
      .update(notificationDelivery)
      .set({ nextAttemptAt: sql`now() + make_interval(secs => ${delay})`, lastError: error })
      .where(eq(notificationDelivery.id, row.id));
    await recordDeviceResult(subscriptionId, result, false);
    return;
  }
  await db
    .update(notificationDelivery)
    .set({ status: 'failed', lastError: error })
    .where(eq(notificationDelivery.id, row.id));
  await recordDeviceResult(subscriptionId, result, true);
}

// Removes failed push rows older than a week.
export async function prunePushDeliveries(): Promise<number> {
  const removed = await db
    .delete(notificationDelivery)
    .where(
      and(
        eq(notificationDelivery.channel, 'push'),
        eq(notificationDelivery.status, 'failed'),
        lt(notificationDelivery.createdAt, sql`now() - make_interval(days => ${FAILED_KEEP_DAYS})`),
      ),
    )
    .returning({ id: notificationDelivery.id });
  return removed.length;
}

// One pass: every due push row claimed and sent. Returns how many were handled.
export async function processPushDeliveries(): Promise<number> {
  const claimed = await claim();
  await Promise.all(claimed.map(handle));
  if (Date.now() - prunedAt > PRUNE_EVERY_MS) {
    prunedAt = Date.now();
    await prunePushDeliveries();
  }
  return claimed.length;
}
