import type { CoreEventData, CoreEventType } from '@helena/sdk';
import { publishDomainEvent } from '#shared/helena';
import type { WebhookEventType } from './service';

// Issue and comment changes are domain events (`helena.issue.*`, `helena.comment.*`,
// CloudEvents in the outbox). Outgoing webhooks are one consumer of them: the worker's
// dispatcher runs the fan-out (@repo/db fanOutWebhooks), which queues one delivery per
// subscribed webhook with the same Linear-style body as before. Workflow triggers, the
// knowledge index and plugins consume the same events.
//
// Call it right after a domain mutation, next to the activity log, the way the issue
// service handles its other post-write side effects. The event carries the resource as
// the API returns it (`snapshot`), which is what a webhook receives as `data`.

type ResourceEvent = `helena.${WebhookEventType}` & CoreEventType;

interface Resource {
  id?: number;
  identifier?: string;
  issueId?: number | null;
  title?: string;
  parentId?: number | null;
}

function eventData(
  projectId: number,
  eventType: WebhookEventType,
  data: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const resource = (data ?? {}) as Resource;
  if (eventType.startsWith('comment.')) {
    return {
      commentId: resource.id ?? 0,
      issueId: resource.issueId ?? 0,
      projectId,
      snapshot: data,
      ...extra,
    };
  }
  return {
    issueId: resource.id ?? 0,
    identifier: resource.identifier ?? '',
    projectId,
    ...(eventType === 'issue.created'
      ? { title: resource.title ?? '', parentId: resource.parentId ?? null }
      : {}),
    snapshot: data,
    ...extra,
  };
}

// Publishes one issue or comment event. `extra` adds the fields an event type has beyond
// the resource (issue.assigned: field, assigneeId, previousAssigneeId). `actor` is who
// caused it (a user id, or `system:workflow` for a workflow's own change, which starts no
// workflow in turn).
export async function publishResourceEvent(
  projectId: number,
  eventType: WebhookEventType,
  data: unknown,
  extra: Record<string, unknown> = {},
  actor: string | null = null,
): Promise<void> {
  const type = `helena.${eventType}` as ResourceEvent;
  const subject = eventType.startsWith('comment.')
    ? `comments/${(data as Resource | null)?.id ?? ''}`
    : `issues/${(data as Resource | null)?.id ?? ''}`;
  await publishDomainEvent({
    type,
    projectId,
    subject,
    ...(actor ? { actor } : {}),
    data: eventData(projectId, eventType, data, extra) as unknown as CoreEventData[typeof type],
  });
}

// Several events of one type at once, for a write whose payloads cost their own queries
// (linking two issues loads both).
export async function publishResourceEvents(
  projectId: number,
  eventType: WebhookEventType,
  load: () => Promise<unknown[]>,
): Promise<void> {
  for (const data of await load()) await publishResourceEvent(projectId, eventType, data);
}

// The names the issue and comment services have always called.
export const emitWebhookEvent = publishResourceEvent;
export const emitWebhookEvents = publishResourceEvents;
