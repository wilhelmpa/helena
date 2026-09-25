import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NotificationCategory } from '@helena/sdk';
import { db, helenaPushPresence, user } from '@repo/db';
import { enqueuePush, type PushNotice } from '@helena/push';

// Who a push goes to, and the one way Helena's features queue one.

// The instance owners (the Administrator role), who receive the machine's alerts.
export async function instanceOwners(): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, 'god'), or(isNull(user.active), eq(user.active, true))));
  return rows.map((row) => row.id);
}

async function keepOwners(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, userIds), eq(user.role, 'god')));
  return rows.map((row) => row.id);
}

// Whether the person is looking at Helena right now, on any device.
export async function isLooking(userId: string): Promise<boolean> {
  // The database's clock on both sides: the page's report stored now() plus the window.
  const rows = await db
    .select({ userId: helenaPushPresence.userId })
    .from(helenaPushPresence)
    .where(
      and(eq(helenaPushPresence.userId, userId), gt(helenaPushPresence.visibleUntil, sql`now()`)),
    );
  return rows.length > 0;
}

// Queues a push of `category` for the people named: an owner-only category reaches only
// owners, whatever the caller passed. The category's urgency and lifetime apply unless the
// notice sets its own.
export async function pushTo(
  userIds: string[],
  category: NotificationCategory,
  notice: Omit<PushNotice, 'category' | 'defaultOn' | 'urgency' | 'ttlSeconds'> &
    Partial<Pick<PushNotice, 'urgency' | 'ttlSeconds'>>,
): Promise<number> {
  const people = category.audience === 'owner' ? await keepOwners(userIds) : userIds;
  return enqueuePush(people, {
    ...notice,
    category: category.id,
    defaultOn: category.defaultOn,
    urgency: notice.urgency ?? category.urgency ?? 'normal',
    ttlSeconds: notice.ttlSeconds ?? category.ttlSeconds ?? 86_400,
  });
}
