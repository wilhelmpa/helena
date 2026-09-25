import {
  consoleLogger,
  normalizeAlertItem,
  type AlertItem,
  type AlertSource,
  type NotificationCategory,
} from '@helena/sdk';
import { formatPush, formatPushDuration } from '@helena/locales/push';
import { db, helenaAlert } from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { intEnv } from '#shared/lib';
import { registries } from '#shared/helena';
import { notificationCategory } from './categories';
import { alertText } from './render';
import { instanceOwners, pushTo } from './recipients';

// Watches every alert source (@helena/sdk AlertSource) from the api, once a minute, whether or
// not anyone has Helena open (docs/helena-decisions/push.md). A problem is pushed to the
// instance owners once it has lasted its grace period, again as a reminder while it stays
// open that long again (12 hours), and once more when a successful read of its source no
// longer reports it; nothing in between, however often it is read. A source that cannot be
// read changes nothing: what it reported stays open, and no recovery is announced.
//
// The state is helena_alert, one row per problem. Every step that pushes moves the row with a
// conditional update first, so two api replicas that check at the same moment push once.

const DEFAULT_GRACE_SECONDS = 90;
const COLLECT_TIMEOUT_MS = 30_000;
const RESOLVED_KEEP_DAYS = 30;
const log = consoleLogger('push alerts');

type AlertRow = typeof helenaAlert.$inferSelect;

export interface AlertCheck {
  opened: number;
  reminded: number;
  resolved: number;
  failed: string[];
}

const alertKey = (source: string, key: string) => `${source}|${key}`;

function reminderMs(): number {
  return intEnv('HELENA_PUSH_REMINDER_HOURS', 12) * 3_600_000;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// The texts a phone shows. The title names the category ("Notfall: Spiegel md127"); a
// category of a plugin reads plainly.
function titleKey(category: string, moment: 'open' | 'reminder' | 'resolved'): string {
  const group = category === 'emergencies' || category === 'needs-you' ? category : 'other';
  return `alert.${group}.${moment}`;
}

async function announce(
  row: AlertRow,
  category: NotificationCategory | undefined,
  moment: 'open' | 'reminder' | 'resolved',
  owners: string[],
  now: Date,
): Promise<void> {
  if (!category || owners.length === 0) return;
  const openedMs = row.openedAt.getTime();
  const stamp = moment === 'reminder' ? now.getTime() : openedMs;
  await pushTo(owners, category, {
    dedupeKey: `alert:${row.key}:${moment}:${stamp}`,
    tag: `alert:${row.key}`,
    url: row.href ?? '/',
    renotify: moment !== 'resolved',
    requireInteraction: moment !== 'resolved' && category.id === 'emergencies',
    // A recovery is news, not an alarm: it need not wake the phone.
    ...(moment === 'resolved' ? { urgency: 'normal' as const } : {}),
    at: now,
    render(locale) {
      const subject = alertText(row.subject, locale);
      const text = alertText(row.text, locale);
      const title = formatPush(locale, titleKey(category.id, moment), { subject });
      if (moment === 'open') return { title, body: text };
      if (moment === 'reminder') {
        const duration = formatPushDuration(locale, now.getTime() - openedMs);
        return { title, body: formatPush(locale, 'alert.reminderBody', { text, duration }) };
      }
      const duration = formatPushDuration(locale, now.getTime() - openedMs);
      return { title, body: formatPush(locale, 'alert.resolvedBody', { duration }) };
    },
  });
}

// Records what one successful read of a source reported, and pushes what is due.
async function reconcile(
  source: AlertSource,
  items: AlertItem[],
  owners: string[],
  now: Date,
  result: AlertCheck,
): Promise<void> {
  const category = notificationCategory(source.category);
  const graceOf = (item: AlertItem) =>
    (item.graceSeconds ?? source.graceSeconds ?? DEFAULT_GRACE_SECONDS) * 1000;
  const keys = items.map((item) => alertKey(source.id, item.key));

  for (const item of items) {
    const key = alertKey(source.id, item.key);
    // A problem seen again after it was resolved opens afresh.
    const [row] = await db
      .insert(helenaAlert)
      .values({
        key,
        source: source.id,
        category: source.category,
        subject: item.subject,
        text: item.text,
        href: item.href ?? null,
        openedAt: now,
        seenAt: now,
      })
      .onConflictDoUpdate({
        target: helenaAlert.key,
        set: {
          category: source.category,
          subject: item.subject,
          text: item.text,
          href: item.href ?? null,
          seenAt: now,
          openedAt: sql`CASE WHEN ${helenaAlert.resolvedAt} IS NULL THEN ${helenaAlert.openedAt} ELSE ${now.toISOString()}::timestamptz END`,
          notifiedAt: sql`CASE WHEN ${helenaAlert.resolvedAt} IS NULL THEN ${helenaAlert.notifiedAt} ELSE NULL END`,
          resolvedAt: null,
        },
      })
      .returning();
    if (!row) continue;

    if (row.notifiedAt === null) {
      if (now.getTime() - row.openedAt.getTime() < graceOf(item)) continue;
      const [claimed] = await db
        .update(helenaAlert)
        .set({ notifiedAt: now })
        .where(
          and(
            eq(helenaAlert.key, key),
            isNull(helenaAlert.notifiedAt),
            isNull(helenaAlert.resolvedAt),
          ),
        )
        .returning();
      if (!claimed) continue;
      await announce(claimed, category, 'open', owners, now);
      result.opened += 1;
    } else if (now.getTime() - row.notifiedAt.getTime() >= reminderMs()) {
      const [claimed] = await db
        .update(helenaAlert)
        .set({ notifiedAt: now })
        .where(and(eq(helenaAlert.key, key), eq(helenaAlert.notifiedAt, row.notifiedAt)))
        .returning();
      if (!claimed) continue;
      await announce(claimed, category, 'reminder', owners, now);
      result.reminded += 1;
    }
  }

  const gone = await db
    .update(helenaAlert)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(helenaAlert.source, source.id),
        isNull(helenaAlert.resolvedAt),
        ...(keys.length > 0 ? [notInArray(helenaAlert.key, keys)] : []),
      ),
    )
    .returning();
  for (const row of gone) {
    // Only what was announced is announced as over; a blip inside the grace period
    // resolves silently.
    if (row.notifiedAt === null) continue;
    await announce(row, category, 'resolved', owners, now);
    result.resolved += 1;
  }
}

let prunedAt = 0;
const lastFailure = new Map<string, string>();

// One check of every alert source.
export async function checkAlerts(now = new Date()): Promise<AlertCheck> {
  const result: AlertCheck = { opened: 0, reminded: 0, resolved: 0, failed: [] };
  const owners = await instanceOwners();
  for (const entry of registries.alertSources.entriesList()) {
    const source = entry.value;
    let items: AlertItem[];
    try {
      const found = await withTimeout(
        source.collect({ now, log: consoleLogger(`alerts ${source.id}`) }),
        COLLECT_TIMEOUT_MS,
      );
      items = [];
      const seen = new Set<string>();
      for (const raw of Array.isArray(found) ? found : []) {
        const item = normalizeAlertItem(raw);
        if (!item || seen.has(item.key)) continue;
        seen.add(item.key);
        items.push(item);
      }
      lastFailure.delete(source.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push(source.id);
      // Said once per new reason, not every minute.
      if (lastFailure.get(source.id) !== message) {
        lastFailure.set(source.id, message);
        log.warn(`${source.id} could not be read; its alerts stay as they are`, { error: message });
      }
      continue;
    }
    try {
      await reconcile(source, items, owners, now, result);
    } catch (error) {
      result.failed.push(source.id);
      log.error(`${source.id} could not be recorded`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (now.getTime() - prunedAt > 3_600_000) {
    prunedAt = now.getTime();
    await db
      .delete(helenaAlert)
      .where(
        and(
          isNotNull(helenaAlert.resolvedAt),
          lt(helenaAlert.resolvedAt, new Date(now.getTime() - RESOLVED_KEEP_DAYS * 86_400_000)),
        ),
      );
  }
  return result;
}

// The problems open right now, for the settings page ("what would ring").
export async function openAlerts(): Promise<AlertRow[]> {
  return db.select().from(helenaAlert).where(isNull(helenaAlert.resolvedAt));
}

// Test helper: forget a source's alerts.
export async function clearAlerts(sources: string[]): Promise<void> {
  if (sources.length === 0) return;
  await db.delete(helenaAlert).where(inArray(helenaAlert.source, sources));
}
