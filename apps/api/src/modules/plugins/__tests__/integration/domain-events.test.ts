import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { HelenaEvent } from '@helena/sdk';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { events } from '#shared/helena';

// Changes publish CloudEvents on the API's event bus (@helena/sdk). These check what the
// bus carries; a subscriber in the test sees exactly what webhooks, triggers and plugins
// see.

let seen: HelenaEvent[] = [];
let unsubscribe: () => void = () => {};

describe('domain events', () => {
  beforeEach(async () => {
    await resetDb();
    seen = [];
    unsubscribe = events.subscribe('*', (event) => void seen.push(event), { id: 'test-capture' });
  });
  afterEach(() => unsubscribe());

  it('publishes issue.created, updated, state_changed and assigned as CloudEvents', async () => {
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

    const types = seen.map((event) => event.type);
    expect(types).toContain('helena.issue.created');
    expect(types).toContain('helena.issue.updated');
    expect(types).toContain('helena.issue.state_changed');
    expect(types).toContain('helena.issue.assigned');

    const createdEvent = seen.find((event) => event.type === 'helena.issue.created')!;
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

    const assigned = seen.find((event) => event.type === 'helena.issue.assigned')!;
    expect(assigned.data).toMatchObject({
      field: 'assignee',
      assigneeId: owner.userId,
      previousAssigneeId: null,
    });
  });

  it('publishes comment.created with the comment', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.projects.post({ key: 'EVT', name: 'Events' });
    const view = await api.projects({ projectKey: 'EVT' }).get();
    const issue = await api
      .projects({ projectKey: 'EVT' })
      .issues.post({ columnId: view.data!.columns[0]!.id, title: 'One' });
    await api.issues({ issueId: issue.data!.id }).comments.post({ body: 'looks good' });
    const comment = seen.find((event) => event.type === 'helena.comment.created')!;
    expect(comment.data).toMatchObject({ issueId: issue.data!.id });
    expect(comment.subject).toMatch(/^comments\/\d+$/);
  });
});
