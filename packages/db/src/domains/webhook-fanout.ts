import type { HelenaEvent } from '@helena/sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { webhook, webhookDelivery } from '../schema/app';

// Outgoing webhooks as a durable domain event consumer (docs/helena-framework.md). For
// every `helena.issue.*` / `helena.comment.*` event that carries the resource
// (`data.snapshot`), it queues one delivery per active webhook of the project that
// subscribes to the event; the worker's webhook loop then signs and posts them as
// before. The body keeps the Linear-style envelope receivers already parse.

export const WEBHOOK_CONSUMER_ID = 'helena.webhooks:fanout';

// Maps our granular event type to the Linear-style envelope's action + resource type.
// Linear's action/type pair cannot tell assigned, state_changed and label_changed apart
// (all are an issue update), so the payload keeps the granular event in `event`.
export const WEBHOOK_EVENT_SHAPE = {
  'issue.created': { action: 'create', type: 'Issue' },
  'issue.updated': { action: 'update', type: 'Issue' },
  'issue.deleted': { action: 'remove', type: 'Issue' },
  'issue.assigned': { action: 'update', type: 'Issue' },
  'issue.state_changed': { action: 'update', type: 'Issue' },
  'issue.label_changed': { action: 'update', type: 'Issue' },
  'issue.link_changed': { action: 'update', type: 'Issue' },
  'comment.created': { action: 'create', type: 'Comment' },
  'comment.updated': { action: 'update', type: 'Comment' },
  'comment.deleted': { action: 'remove', type: 'Comment' },
} as const;

export type WebhookEventName = keyof typeof WEBHOOK_EVENT_SHAPE;

export const WEBHOOK_EVENT_PATTERNS = ['helena.issue.*', 'helena.comment.*'];

// The webhook event a domain event is delivered as, or null for one no webhook can
// subscribe to. Only a change of the assignee is `issue.assigned`; a delegate change is
// not a webhook event.
export function webhookEventOf(event: HelenaEvent): WebhookEventName | null {
  const name = event.type.replace(/^helena\./, '');
  if (!(name in WEBHOOK_EVENT_SHAPE)) return null;
  const data = event.data as { field?: string } | null;
  if (name === 'issue.assigned' && data?.field !== 'assignee') return null;
  return name as WebhookEventName;
}

export async function fanOutWebhooks(event: HelenaEvent): Promise<number> {
  const eventType = webhookEventOf(event);
  const projectId = event.helenaproject;
  const snapshot = (event.data as { snapshot?: unknown } | null)?.snapshot;
  if (!eventType || projectId == null || snapshot === undefined) return 0;

  const matching = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.projectId, projectId),
        eq(webhook.isActive, true),
        // events is a jsonb array of event-type strings. @> tests membership.
        sql`${webhook.events} @> ${JSON.stringify([eventType])}::jsonb`,
      ),
    );
  if (matching.length === 0) return 0;

  // A retried delivery of this event must not queue a second post to a webhook that
  // already has one: the CloudEvent id is the webhook event id.
  const queued = await db
    .select({ webhookId: webhookDelivery.webhookId })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.eventId, event.id),
        inArray(
          webhookDelivery.webhookId,
          matching.map((h) => h.id),
        ),
      ),
    );
  const done = new Set(queued.map((row) => row.webhookId));
  const targets = matching.filter((h) => !done.has(h.id));
  if (targets.length === 0) return 0;

  const { action, type } = WEBHOOK_EVENT_SHAPE[eventType];
  const createdAt = event.time;
  const webhookTimestamp = Date.parse(event.time);
  await db.insert(webhookDelivery).values(
    targets.map((h) => ({
      webhookId: h.id,
      eventId: event.id,
      eventType,
      payload: {
        action,
        type,
        event: eventType,
        createdAt,
        data: snapshot,
        webhookTimestamp,
        webhookId: h.id,
      },
    })),
  );
  return targets.length;
}
