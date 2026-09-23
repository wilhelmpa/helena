import { beforeEach, describe, expect, it } from 'bun:test';
import { db, hubInboxEvent, hubInboxSource, hubInboxThread, issue } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { processActionRuns } from '#modules/actions/runner';
import { processInboxTasks } from '#modules/hub-inbox/tasks';

beforeEach(async () => {
  await resetDb();
});

describe('hub inbox', () => {
  it('lists connected sources and creates one linked task idempotently', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const createdProject = await asOwner.projects.post({ key: 'HELP', name: 'Helpdesk' });
    const project = createdProject.data!;
    const [source] = await db
      .insert(hubInboxSource)
      .values({
        teamId: project.teamId,
        channel: 'mail',
        account: 'team@example.com',
        status: 'connected',
      })
      .returning();
    const [thread] = await db
      .insert(hubInboxThread)
      .values({
        teamId: project.teamId,
        sourceId: source.id,
        externalThreadId: 'mail-thread:41',
        latestExternalMessageId: 'message-1',
        sender: 'customer@example.com',
        subject: 'Please investigate',
        snippet: 'This should become a task.',
        externalUrl: 'javascript:alert(1)',
        receivedAt: new Date('2026-09-21T08:00:00.000Z'),
        projectId: project.id,
        triageStatus: 'succeeded',
        confidence: 0.95,
        requiresAction: true,
      })
      .returning();
    await db.insert(hubInboxEvent).values({
      sourceId: source.id,
      teamId: project.teamId,
      externalEventId: 'event-1',
      externalThreadId: 'mail-thread:41',
      externalMessageId: 'message-1',
      sender: 'customer@example.com',
      subject: 'Please investigate',
      snippet: 'This should become a task.',
      receivedAt: new Date('2026-09-21T08:00:00.000Z'),
      status: 'succeeded',
    });
    await asOwner.projects({ projectKey: project.key }).actions.post({
      name: 'Prioritize inbox evidence',
      trigger: 'issue_comment_added',
      effect: { priority: 'high' },
    });

    const sourceResponse = await request(
      owner.cookie,
      `/hub-inbox/sources?teamId=${project.teamId}`,
    );
    expect(sourceResponse.status).toBe(200);
    expect(await sourceResponse.json()).toMatchObject([
      { account: 'team@example.com', status: 'connected', autoCreateTasks: false },
    ]);

    const first = await request(owner.cookie, `/hub-inbox/threads/${thread.id}/create-task`, {
      method: 'POST',
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { issueId: number; sequenceNumber: number };
    const second = await request(owner.cookie, `/hub-inbox/threads/${thread.id}/create-task`, {
      method: 'POST',
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);

    const rows = await db.select().from(issue).where(eq(issue.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Please investigate' });
    expect(rows[0]?.description).toContain('(/inbox?thread=41)');
    expect(rows[0]?.description).not.toContain('javascript:');
    await processActionRuns();
    const [updatedIssue] = await db.select().from(issue).where(eq(issue.id, firstBody.issueId));
    expect(updatedIssue?.priority).toBe('high');

    const list = await request(owner.cookie, `/hub-inbox/threads?teamId=${project.teamId}`);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [
        {
          externalUrl: '/inbox?thread=41',
          issueIdentifier: 'HELP-1',
          ticketStatus: 'created',
        },
      ],
    });
  });

  it('requires integration permissions for message metadata and triage mutations', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const createdProject = await asOwner.projects.post({ key: 'HELP', name: 'Helpdesk' });
    const project = createdProject.data!;
    const member = await signUpTestUser();
    const invite = await asOwner
      .projects({ projectKey: project.key })
      .invites.post({ email: member.email, role: 'member' });
    const asMember = authedApi(member.cookie);
    await asMember.invites({ token: invite.data!.token }).accept.post();
    const [source] = await db
      .insert(hubInboxSource)
      .values({ teamId: project.teamId, channel: 'mail', account: 'private@example.com' })
      .returning();
    const [thread] = await db
      .insert(hubInboxThread)
      .values({
        teamId: project.teamId,
        sourceId: source.id,
        externalThreadId: 'private-thread',
        latestExternalMessageId: 'private-message',
        sender: 'private@example.com',
        subject: 'Private mail subject',
        snippet: 'Private mail snippet',
        receivedAt: new Date(),
        triageStatus: 'failed',
      })
      .returning();

    expect(
      (await request(member.cookie, `/hub-inbox/sources?teamId=${project.teamId}`)).status,
    ).toBe(403);
    expect(
      (await request(member.cookie, `/hub-inbox/threads?teamId=${project.teamId}`)).status,
    ).toBe(403);
    expect(
      (
        await request(member.cookie, `/hub-inbox/threads/${thread.id}/retry-triage`, {
          method: 'POST',
        })
      ).status,
    ).toBe(403);
  });

  it('runs an authorized inbox workflow after automatic task creation', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const target = (await asOwner.projects.post({ key: 'PRIV', name: 'Private' })).data!;
    const [source] = await db
      .insert(hubInboxSource)
      .values({
        teamId: target.teamId,
        channel: 'mail',
        account: 'team@example.com',
        status: 'connected',
        autoCreateTasks: true,
        autoTaskProjectId: target.id,
        automationActorUserId: owner.userId,
      })
      .returning();
    await asOwner.projects({ projectKey: target.key }).actions.post({
      name: 'Prioritize automatic inbox task',
      trigger: 'issue_comment_added',
      effect: { priority: 'urgent' },
    });
    await db.insert(hubInboxEvent).values({
      sourceId: source.id,
      teamId: target.teamId,
      externalEventId: 'automatic-event',
      externalThreadId: 'automatic-thread',
      externalMessageId: 'automatic-message',
      sender: 'customer@example.com',
      subject: 'Automatic task',
      snippet: 'A tested relevant message.',
      receivedAt: new Date('2026-09-21T08:30:00.000Z'),
      status: 'succeeded',
    });
    const [thread] = await db
      .insert(hubInboxThread)
      .values({
        teamId: target.teamId,
        sourceId: source.id,
        externalThreadId: 'automatic-thread',
        latestExternalMessageId: 'automatic-message',
        sender: 'customer@example.com',
        subject: 'Automatic task',
        snippet: 'A tested relevant message.',
        receivedAt: new Date('2026-09-21T08:30:00.000Z'),
        projectId: target.id,
        triageStatus: 'succeeded',
        confidence: 0.99,
        requiresAction: true,
        ticketStatus: 'pending',
      })
      .returning();

    await processInboxTasks();
    await processActionRuns();

    const [linked] = await db
      .select({ issueId: hubInboxThread.issueId, ticketStatus: hubInboxThread.ticketStatus })
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, thread.id));
    expect(linked?.ticketStatus).toBe('created');
    const [created] = await db.select().from(issue).where(eq(issue.id, linked!.issueId!));
    expect(created).toMatchObject({ projectId: target.id, priority: 'urgent' });
  });

  it('rejects malformed cursors and retrying active triage', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const project = (await asOwner.projects.post({ key: 'HELP', name: 'Helpdesk' })).data!;
    const [source] = await db
      .insert(hubInboxSource)
      .values({ teamId: project.teamId, channel: 'mail', account: 'team@example.com' })
      .returning();
    const [thread] = await db
      .insert(hubInboxThread)
      .values({
        teamId: project.teamId,
        sourceId: source.id,
        externalThreadId: 'thread-2',
        latestExternalMessageId: 'message-2',
        sender: 'sender@example.com',
        receivedAt: new Date(),
        triageStatus: 'running',
      })
      .returning();

    expect(
      (await request(owner.cookie, `/hub-inbox/threads?teamId=${project.teamId}&cursor=nope`))
        .status,
    ).toBe(400);
    expect(
      (
        await request(owner.cookie, `/hub-inbox/threads/${thread.id}/retry-triage`, {
          method: 'POST',
        })
      ).status,
    ).toBe(409);
  });

  it('requires a same-team automatic task project before enabling creation', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const primary = (await asOwner.projects.post({ key: 'PRIV', name: 'Private' })).data!;
    const [source] = await db
      .insert(hubInboxSource)
      .values({ teamId: primary.teamId, channel: 'mail', account: 'team@example.com' })
      .returning();

    const missingTarget = await request(owner.cookie, `/hub-inbox/sources/${source.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ autoCreateTasks: true }),
    });
    expect(missingTarget.status).toBe(400);

    const configured = await request(owner.cookie, `/hub-inbox/sources/${source.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        confidenceThreshold: 0.9,
        autoTaskProjectId: primary.id,
        autoCreateTasks: true,
      }),
    });
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({
      confidenceThreshold: 0.9,
      autoTaskProjectId: primary.id,
      autoCreateTasks: true,
    });
    const [configuredSource] = await db
      .select({ automationActorUserId: hubInboxSource.automationActorUserId })
      .from(hubInboxSource)
      .where(eq(hubInboxSource.id, source.id));
    expect(configuredSource?.automationActorUserId).toBe(owner.userId);

    const otherOwner = await signUpTestUser();
    const otherProject = (
      await authedApi(otherOwner.cookie).projects.post({ key: 'OTHER', name: 'Other' })
    ).data!;
    const crossTeam = await request(owner.cookie, `/hub-inbox/sources/${source.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ autoTaskProjectId: otherProject.id }),
    });
    expect(crossTeam.status).toBe(400);
  });
});

function request(cookie: string, path: string, init: RequestInit = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { cookie, 'content-type': 'application/json', ...init.headers },
    }),
  );
}
