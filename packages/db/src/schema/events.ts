import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// The domain event outbox (@helena/sdk events, docs/helena-framework.md). A change writes
// its CloudEvent here, in its own transaction where it has one; the worker's dispatcher
// fans every new event out to the durable subscribers whose patterns match, one delivery
// row each, and runs them with retries. Rows are pruned after a week once every delivery
// finished.
export const helenaDomainEvent = pgTable(
  'helena_domain_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // The CloudEvents id: unique, what consumers deduplicate on.
    eventId: uuid('event_id').notNull(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    subject: text('subject'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    teamId: integer('team_id'),
    projectId: integer('project_id'),
    actor: text('actor'),
    // The whole CloudEvent (structured JSON format), as consumers receive it.
    event: jsonb('event').notNull(),
    // Set once the dispatcher created the event's deliveries.
    fannedOutAt: timestamp('fanned_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_domain_event_event_id_idx').on(t.eventId),
    index('helena_domain_event_pending_idx')
      .on(t.id)
      .where(sql`${t.fannedOutAt} is null`),
    index('helena_domain_event_type_idx').on(t.type, t.occurredAt),
  ],
);

// One delivery of one event to one durable subscriber (a webhook fan-out, a workflow
// trigger, the knowledge indexer, a plugin). status: pending | done | failed.
export const helenaDomainEventDelivery = pgTable(
  'helena_domain_event_delivery',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventRowId: bigint('event_row_id', { mode: 'number' })
      .notNull()
      .references(() => helenaDomainEvent.id, { onDelete: 'cascade' }),
    consumer: text('consumer').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    // Set while a dispatcher works on it; a crashed dispatcher's lease runs out.
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_domain_event_delivery_event_consumer_idx').on(t.eventRowId, t.consumer),
    index('helena_domain_event_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
