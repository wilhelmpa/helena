import type { HelenaEvent } from '@helena/sdk';
import type { OutboxDelivery, OutboxStore } from '@helena/sdk/server';
import { and, asc, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from './client';
import { helenaDomainEvent, helenaDomainEventDelivery } from './schema/events';

// The Postgres side of the domain event outbox (@helena/sdk OutboxStore): appending
// events, fanning them out to durable subscribers, and claiming deliveries with
// FOR UPDATE SKIP LOCKED so several dispatchers never run the same one.

type Executor = Pick<typeof db, 'insert'>;

// Writes events to the outbox. Pass the transaction of the change that raised them, so
// the event exists exactly when the change does.
export async function appendDomainEvents(
  events: HelenaEvent[],
  executor: Executor = db,
): Promise<void> {
  if (events.length === 0) return;
  await executor.insert(helenaDomainEvent).values(
    events.map((event) => ({
      eventId: event.id,
      type: event.type,
      source: event.source,
      subject: event.subject ?? null,
      occurredAt: new Date(event.time),
      teamId: event.helenateam ?? null,
      projectId: event.helenaproject ?? null,
      actor: event.helenaactor ?? null,
      event,
    })),
  );
}

export function domainEventStore(): OutboxStore {
  return {
    async fanOut(route, limit) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: helenaDomainEvent.id, event: helenaDomainEvent.event })
          .from(helenaDomainEvent)
          .where(isNull(helenaDomainEvent.fannedOutAt))
          .orderBy(asc(helenaDomainEvent.id))
          .limit(limit)
          .for('update', { skipLocked: true });
        if (rows.length === 0) return 0;
        const deliveries = rows.flatMap((row) =>
          route(row.event as HelenaEvent).map((consumer) => ({ eventRowId: row.id, consumer })),
        );
        if (deliveries.length > 0) {
          await tx.insert(helenaDomainEventDelivery).values(deliveries).onConflictDoNothing();
        }
        await tx
          .update(helenaDomainEvent)
          .set({ fannedOutAt: sql`now()` })
          .where(
            inArray(
              helenaDomainEvent.id,
              rows.map((row) => row.id),
            ),
          );
        return rows.length;
      });
    },

    async claim(consumers, limit, leaseMs) {
      if (consumers.length === 0) return [];
      const claimed = await db.execute<{
        id: number;
        consumer: string;
        attempts: number;
        event: HelenaEvent;
      }>(sql`
        with due as (
          select d.id
          from ${helenaDomainEventDelivery} d
          where d.status = 'pending'
            and d.next_attempt_at <= now()
            and (d.leased_until is null or d.leased_until < now())
            and d.consumer in (${sql.join(
              consumers.map((consumer) => sql`${consumer}`),
              sql`, `,
            )})
          order by d.id
          limit ${limit}
          for update skip locked
        )
        update ${helenaDomainEventDelivery} d
        set attempts = d.attempts + 1,
            leased_until = now() + (${leaseMs}::int * interval '1 millisecond')
        from due, ${helenaDomainEvent} e
        where d.id = due.id and e.id = d.event_row_id
        returning d.id, d.consumer, d.attempts, e.event
      `);
      return [...claimed]
        .map((row): OutboxDelivery => ({
          deliveryId: Number(row.id),
          consumer: row.consumer,
          attempt: Number(row.attempts),
          event: row.event,
        }))
        .sort((a, b) => a.deliveryId - b.deliveryId);
    },

    async complete(deliveryId) {
      await db
        .update(helenaDomainEventDelivery)
        .set({ status: 'done', deliveredAt: sql`now()`, leasedUntil: null, lastError: null })
        .where(sql`${helenaDomainEventDelivery.id} = ${deliveryId}`);
    },

    async retry(deliveryId, at, error) {
      await db
        .update(helenaDomainEventDelivery)
        .set({ nextAttemptAt: at, leasedUntil: null, lastError: error.slice(0, 2000) })
        .where(sql`${helenaDomainEventDelivery.id} = ${deliveryId}`);
    },

    async fail(deliveryId, error) {
      await db
        .update(helenaDomainEventDelivery)
        .set({ status: 'failed', leasedUntil: null, lastError: error.slice(0, 2000) })
        .where(sql`${helenaDomainEventDelivery.id} = ${deliveryId}`);
    },

    async prune(before) {
      const removed = await db
        .delete(helenaDomainEvent)
        .where(
          and(
            lt(helenaDomainEvent.createdAt, before),
            sql`${helenaDomainEvent.fannedOutAt} is not null`,
            sql`not exists (select 1 from ${helenaDomainEventDelivery} d where d.event_row_id = ${helenaDomainEvent.id} and d.status = 'pending')`,
          ),
        )
        .returning({ id: helenaDomainEvent.id });
      return removed.length;
    },
  };
}
