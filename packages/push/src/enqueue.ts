import { inArray } from 'drizzle-orm';
import {
  db,
  helenaPushSubscription,
  notificationDelivery,
  type DeliveryPayload,
  type PushDeliveryMessage,
} from '@repo/db';
import type { PushUrgency } from '@helena/sdk';
import { wantsCategory } from './choices';
import { pushTopic } from './payload';

export { wantsCategory };

// Puts a message for people into the notification outbox, one row per device that has the
// message's category switched on. The text is written here, in each device's language; the
// drain (drain.ts) only encrypts and sends. Nothing here waits on a push service, so a
// caller in a request path pays for one insert.

export interface PushNotice {
  // The notification category (@helena/sdk NotificationCategory) and its default, for a
  // device that never switched it.
  category: string;
  defaultOn: boolean;
  urgency: PushUrgency;
  ttlSeconds: number;
  // Unique per message: the same key is queued once per device while it waits.
  dedupeKey: string;
  // A later message with the same tag replaces this one on the device (and, via the
  // topic, at the push service while the device is offline).
  tag: string;
  // Where a tap leads inside Helena.
  url: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  at?: Date;
  // The title and body in a device's language.
  render(locale: string): { title: string; body: string };
}

// Queues the notice for every device of the people named that wants it; returns how many
// rows were queued (a device that already has the same message waiting counts none).
export async function enqueuePush(userIds: string[], notice: PushNotice): Promise<number> {
  const people = [...new Set(userIds.filter(Boolean))];
  if (people.length === 0) return 0;
  const devices = await db
    .select({
      id: helenaPushSubscription.id,
      locale: helenaPushSubscription.locale,
      categories: helenaPushSubscription.categories,
    })
    .from(helenaPushSubscription)
    .where(inArray(helenaPushSubscription.userId, people));
  const wanted = devices.filter((device) =>
    wantsCategory(device.categories, notice.category, notice.defaultOn),
  );
  if (wanted.length === 0) return 0;

  const at = (notice.at ?? new Date()).toISOString();
  const texts = new Map<string, { title: string; body: string }>();
  const rows = wanted.map((device) => {
    let text = texts.get(device.locale);
    if (!text) {
      text = notice.render(device.locale);
      texts.set(device.locale, text);
    }
    const push: PushDeliveryMessage = {
      category: notice.category,
      title: text.title,
      body: text.body,
      url: notice.url,
      tag: notice.tag,
      ...(notice.renotify ? { renotify: true } : {}),
      ...(notice.requireInteraction ? { requireInteraction: true } : {}),
      urgency: notice.urgency,
      ttlSeconds: notice.ttlSeconds,
      topic: pushTopic(notice.tag),
      at,
    };
    const payload: DeliveryPayload = {
      text: text.body,
      subject: text.title,
      url: notice.url,
      dedupeKey: notice.dedupeKey,
      push,
    };
    return {
      projectId: null,
      channel: 'push',
      recipient: String(device.id),
      payload,
    };
  });
  const queued = await db
    .insert(notificationDelivery)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notificationDelivery.id });
  return queued.length;
}
