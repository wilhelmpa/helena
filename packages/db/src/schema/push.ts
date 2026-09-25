// Web Push to a person's own devices (docs/helena-decisions/push.md): the devices that
// subscribed, whether a person is looking at Helena right now, and the problems Helena is
// watching so it pushes once when one appears and once when it is over. The messages
// themselves wait in notification_delivery (channel 'push'). The instance's VAPID keys are
// an encrypted app_secret ('push.vapid'), never a column here.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AlertText } from '@helena/sdk';
import { user } from './auth';

// One browser's push subscription (PushSubscription.toJSON() in the browser). The endpoint
// is the push service's URL for this one device and app; with the device's public key and
// auth secret it is what a message is encrypted to (RFC 8291). Pushing to it also needs the
// instance's VAPID private key, so the row alone sends nothing.
export const helenaPushSubscription = pgTable(
  'helena_push_subscription',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    // The VAPID public key the browser subscribed with (applicationServerKey). A
    // subscription made with another key cannot be pushed to; the app subscribes anew.
    vapidKey: text('vapid_key').notNull(),
    // What the person calls the device, prefilled from the browser ("iPhone · Safari").
    label: text('label').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    // The language the device's Helena runs in; its messages are written in it.
    locale: text('locale').notNull().default('en'),
    // The categories the person switched on or off on this device; a category not named
    // here follows its default.
    categories: jsonb('categories').$type<Record<string, boolean>>().notNull().default({}),
    // PushSubscription.expirationTime, where the push service sets one.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    // Failures since the last message that arrived.
    failureCount: integer('failure_count').notNull().default(0),
    // The push service's answer to the last failure, short and without the endpoint.
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('helena_push_subscription_endpoint_idx').on(t.endpoint),
    index('helena_push_subscription_user_idx').on(t.userId),
  ],
);

// Whether a person is looking at Helena right now, on any device: a visible page reports
// itself every minute. An agent's chat answer is pushed only while nobody looks.
export const helenaPushPresence = pgTable('helena_push_presence', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  visibleUntil: timestamp('visible_until', { withTimezone: true }).notNull(),
});

// A problem an alert source reports (@helena/sdk AlertSource), as Helena watches it: open
// while the source reports it, resolved when a successful read no longer does. One push
// when it has lasted the source's grace period, a reminder while it stays open that long
// again (12 hours), and one when it is resolved, only if it was pushed.
export const helenaAlert = pgTable(
  'helena_alert',
  {
    // `<source id>|<item key>`.
    key: text('key').primaryKey(),
    source: text('source').notNull(),
    category: text('category').notNull(),
    subject: jsonb('subject').$type<AlertText>().notNull(),
    text: jsonb('text').$type<AlertText>().notNull(),
    href: text('href'),
    // Since when it is open this time, and when a read last reported it.
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
    // The last push about it (the first one or a reminder); null while none went out.
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('helena_alert_open_idx')
      .on(t.source)
      .where(sql`${t.resolvedAt} IS NULL`),
    check('helena_alert_key_check', sql`length(${t.key}) <= 300`),
  ],
);
