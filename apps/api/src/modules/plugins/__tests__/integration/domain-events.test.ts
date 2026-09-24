import { beforeEach, describe, expect, it } from 'bun:test';
import { db, helenaDomainEvent } from '@repo/db';
import { asc } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { deliverDomainEvents } from '#tests/helpers/events';

// Changes publish CloudEvents to the outbox (helena_domain_event); the worker's
// dispatcher hands them to durable consumers. These check what lands in the outbox.

async function outbox() {
  const rows = await db.select().from(helenaDomainEvent).orderBy(asc(helenaDomainEvent.id));
  return rows.map((row) => row.event as Record<string, unknown>);
}

describe('domain events', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('records issue.created, issue.updated and issue.assigned as CloudEvents', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.projects.post({ key: 'EVT', name: 'Events' });
    const view = await api.projects({ projectKey: 'EVT' }).get();
    const [first, second] = view.data!.columns;
    const created = await api
      .projects({ projectKey: 'EVT' })
      .issues.post({ columnId: first!.id, title: 'Write the report' });
    const issueId = created.data!.id;
    await api.issues({ issueId }).patch({ columnId: second!.id, assigneeUserId: owner.userId });

    const events = await outbox();
    const types = events.map((event) => event.type);
    expect(types).toContain('helena.issue.created');
    expect(types).toContain('helena.issue.updated');
    expect(types).toContain('helena.issue.state_changed');
    expect(types).toContain('helena.issue.assigned');

    const createdEvent = events.find((event) => event.type === 'helena.issue.created')!;
    expect(createdEvent.specversion).toBe('1.0');
    expect(createdEvent.datacontenttype).toBe('application/json');
    expect(createdEvent.subject).toBe(`issues/${issueId}`);
    expect(createdEvent.source).toBe(`/projects/${createdEvent.helenaproject}`);
    expect(createdEvent.data).toMatchObject({
      issueId,
      identifier: 'EVT-1',
      title: 'Write the report',
      parentId: null,
    });
    // The resource as the API returns it, for consumers that forward it (webhooks).
    expect((createdEvent.data as { snapshot: { id: number } }).snapshot.id).toBe(issueId);
    const assigned = events.find((event) => event.type === 'helena.issue.assigned')!;
    expect(assigned.data).toMatchObject({
      field: 'assignee',
      assigneeId: owner.userId,
      previousAssigneeId: null,
    });
  });

  it('marks events fanned out once the dispatcher ran', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.projects.post({ key: 'EVT', name: 'Events' });
    const view = await api.projects({ projectKey: 'EVT' }).get();
    await api
      .projects({ projectKey: 'EVT' })
      .issues.post({ columnId: view.data!.columns[0]!.id, title: 'One' });
    await deliverDomainEvents();
    const rows = await db.select().from(helenaDomainEvent);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.fannedOutAt !== null)).toBe(true);
  });
});
