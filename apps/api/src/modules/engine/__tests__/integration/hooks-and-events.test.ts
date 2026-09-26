import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { Webhook } from 'standardwebhooks';
import { db, issue as issueTable, pipelineRun } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { publishDomainEvent as publishBusEvent } from '#shared/helena';
import { domainEvent, publishDomainEvent } from '#modules/engine/events';
import { app } from '#tests/helpers/app';
import {
  resetEngineDb,
  runSteps,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForStatus,
} from '#tests/helpers/engine';
import {
  definition,
  enable,
  issue,
  setupProject,
  simple,
  startRun,
  template,
  type Json,
  type ProjectSetup,
} from '#tests/helpers/workflows';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// The ways into and out of the engine besides the builder's own triggers: a workflow's
// webhook (Standard Webhooks or its secret as a bearer token), the new-mail event of the
// mail import, and the webhook step, which signs what it sends with the project's key.

beforeAll(async () => {
  await startEngine();
});

beforeEach(async () => {
  await resetEngineDb();
});

afterEach(async () => {
  delete process.env.SSRF_ALLOW_PRIVATE;
  await stopEngineRuns();
});

afterAll(async () => {
  await stopTestEngine();
});

async function workflow(ctx: ProjectSetup, steps: Json[], trigger: Json) {
  const created = await template(ctx, { definition: definition(steps, { trigger }) });
  expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
  return created.id;
}

const project = (ctx: ProjectSetup) => ctx.asOwner.projects({ projectKey: 'MKT' });

function post(path: string, body: string, headers: Record<string, string>) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
  );
}

async function waitForRuns(pipelineId: number, count: number) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await db.select().from(pipelineRun).where(eq(pipelineRun.pipelineId, pipelineId));
    if (rows.length >= count) return rows;
    if (Date.now() > deadline) throw new Error(`Workflow ${pipelineId} has ${rows.length} runs`);
    await Bun.sleep(100);
  }
}

describe('workflow webhooks', () => {
  it('starts one run per request id on a new task, by bearer secret or Standard Webhooks', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, simple().steps as Json[], {
      type: 'webhook',
      title: 'From outside',
    });
    expect((await project(ctx).pipelines({ pipelineId }).hook.get()).data).toEqual({ hook: null });
    const created = (await project(ctx).pipelines({ pipelineId }).hook.post()).data!;
    expect(created.url).toBe(`/hooks/workflows/${created.id}`);
    expect(created.secret).toStartWith('whsec_');

    const body = JSON.stringify({ title: 'Order 1042', description: 'Ship it.' });
    const first = await post(created.url, body, {
      authorization: `Bearer ${created.secret}`,
      'webhook-id': 'msg_1',
    });
    expect(first.status).toBe(202);
    const { runId } = (await first.json()) as { runId: string };
    // The same request again (a sender's retry) finds the same run.
    const again = await post(created.url, body, {
      authorization: `Bearer ${created.secret}`,
      'webhook-id': 'msg_1',
    });
    expect(((await again.json()) as { runId: string }).runId).toBe(runId);
    const run = await waitForStatus(runId, 'running', 'waiting', 'succeeded', 'failed');
    expect(run).toMatchObject({ trigger: 'webhook', pipelineId });
    const [task] = await db.select().from(issueTable).where(eq(issueTable.id, run.issueId!));
    expect(task).toMatchObject({ title: 'Order 1042', description: 'Ship it.' });

    // Signed per Standard Webhooks, without a title: the trigger's title.
    const signed = '{}';
    const now = new Date();
    const signature = new Webhook(created.secret).sign('msg_2', now, signed);
    const standard = await post(created.url, signed, {
      'webhook-id': 'msg_2',
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': signature,
    });
    expect(standard.status).toBe(202);
    const second = (await standard.json()) as { runId: string };
    const secondRun = await waitForStatus(second.runId, 'running', 'waiting', 'succeeded');
    const [secondTask] = await db
      .select()
      .from(issueTable)
      .where(eq(issueTable.id, secondRun.issueId!));
    expect(secondTask?.title).toBe('From outside');
    expect(await waitForRuns(pipelineId, 2)).toHaveLength(2);
    expect(
      (await project(ctx).pipelines({ pipelineId }).hook.get()).data?.hook?.lastUsedAt,
    ).not.toBeNull();
  });

  it('refuses wrong secrets, bad signatures, a switched-off workflow and a deleted hook', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, simple().steps as Json[], {
      type: 'webhook',
      title: 'From outside',
    });
    const hook = (await project(ctx).pipelines({ pipelineId }).hook.post()).data!;
    expect((await post(hook.url, '{}', {})).status).toBe(401);
    expect((await post(hook.url, '{}', { authorization: 'Bearer whsec_nope' })).status).toBe(401);
    expect(
      (
        await post(hook.url, '{}', {
          'webhook-id': 'msg_x',
          'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
          'webhook-signature': 'v1,AAAA',
        })
      ).status,
    ).toBe(401);
    expect(
      (await post(hook.url, 'not json', { authorization: `Bearer ${hook.secret}` })).status,
    ).toBe(400);

    // A new secret: the old one no longer opens it.
    const renewed = (await project(ctx).pipelines({ pipelineId }).hook.post()).data!;
    expect(renewed.id).toBe(hook.id);
    expect((await post(hook.url, '{}', { authorization: `Bearer ${hook.secret}` })).status).toBe(
      401,
    );

    expect((await enable(ctx, pipelineId, { coder: ctx.coder.id }, false)).status).toBe(200);
    expect((await post(hook.url, '{}', { authorization: `Bearer ${renewed.secret}` })).status).toBe(
      409,
    );
    expect((await project(ctx).pipelines({ pipelineId }).hook.delete()).status).toBe(204);
    expect((await post(hook.url, '{}', { authorization: `Bearer ${renewed.secret}` })).status).toBe(
      404,
    );
    expect(await db.select().from(pipelineRun)).toEqual([]);
  });

  it('gives a hook only to a workflow with a webhook trigger', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, simple().steps as Json[], { type: 'manual' });
    expect((await project(ctx).pipelines({ pipelineId }).hook.post()).status).toBe(409);
  });
});

describe('mail trigger', () => {
  it('starts a run on a task named after a new mail that matches the filters', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, simple().steps as Json[], {
      type: 'mail_received',
      from: 'shop.example',
      subject: 'order',
    });
    const mail = (id: string, from: string, subject: string) =>
      publishDomainEvent(
        domainEvent(
          'helena.mail.received',
          ctx.projectId,
          { from, subject, snippet: 'Two chairs.', threadId: 1, messageId: 7 },
          { id },
        ),
      );
    await mail('mail-1', 'news@elsewhere.example', 'New order');
    await mail('mail-2', 'orders@shop.example', 'Your order 17');
    await mail('mail-2', 'orders@shop.example', 'Your order 17');
    const [run] = await waitForRuns(pipelineId, 1);
    await Bun.sleep(1_000);
    expect(await db.select().from(pipelineRun)).toHaveLength(1);
    const started = await waitForStatus(run!.id, 'running', 'waiting', 'succeeded', 'failed');
    expect(started.trigger).toBe('mail_received');
    const [task] = await db.select().from(issueTable).where(eq(issueTable.id, started.issueId!));
    expect(task).toMatchObject({
      title: 'Your order 17',
      description: 'From: orders@shop.example\n\nTwo chairs.',
    });
  });
});

describe('webhook step', () => {
  it('sends the run signed with the project key, and tries again after a server error', async () => {
    const received: { headers: Record<string, string>; body: string }[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        received.push({ headers: Object.fromEntries(request.headers), body: await request.text() });
        return received.length === 1
          ? new Response('busy', { status: 503 })
          : new Response('thanks', { status: 200 });
      },
    });
    process.env.SSRF_ALLOW_PRIVATE = '1';
    try {
      const ctx = await setupProject();
      const pipelineId = await workflow(
        ctx,
        [
          {
            id: 'tell',
            name: 'Tell the CRM',
            type: 'webhook',
            url: `http://127.0.0.1:${server.port}/in`,
            message: 'Done with {{task.title}}',
          },
        ],
        { type: 'manual' },
      );
      const task = await issue(ctx);
      const run = await startRun(ctx, task.id, pipelineId);
      await waitForStatus(run.id, 'succeeded');
      expect(received).toHaveLength(2);
      // Both tries carry the same id, so the receiver can drop a repeat.
      expect(received[0]!.headers['webhook-id']).toBe(received[1]!.headers['webhook-id']);
      const key = (await project(ctx)['workflow-signing-secret'].get()).data!.secret;
      const payload = new Webhook(key).verify(received[1]!.body, received[1]!.headers) as {
        type: string;
        message: string;
        task: { title: string };
        step: { id: string };
      };
      expect(payload).toMatchObject({
        type: 'helena.workflow.step',
        message: 'Done with Launch page',
        task: { title: 'Launch page' },
        step: { id: 'tell' },
      });
      expect((await runSteps(run.id)).map((row) => [row.stepId, row.status, row.summary])).toEqual([
        ['tell', 'succeeded', 'HTTP 200: thanks'],
      ]);
      // A new key: the next request signs with it.
      const rotated = (await project(ctx)['workflow-signing-secret'].post()).data!.secret;
      expect(rotated).not.toBe(key);
    } finally {
      server.stop(true);
    }
  });

  it('refuses a private address unless the operator allows it', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(
      ctx,
      [{ id: 'tell', name: 'Tell', type: 'webhook', url: 'http://127.0.0.1:9/in', message: '' }],
      { type: 'manual' },
    );
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    const failed = await waitForStatus(run.id, 'failed');
    expect(failed.error).toContain('The URL is not allowed');
  });
});

describe('event transport', () => {
  it('stores a bus event with its change, for the engine and for the worker, and not without it', async () => {
    const ctx = await setupProject();
    const stored = async (id: string) =>
      (
        (await db.execute(
          sql`select workflow_uuid as id from helena_engine.workflow_status where workflow_uuid in (${`event:${id}`}, ${`worker-event:${id}`}) order by 1`,
        )) as unknown as { id: string }[]
      ).map((row) => row.id);
    const event = (id: string) => ({
      id,
      type: 'helena.approval.requested' as const,
      projectId: ctx.projectId,
      data: {
        approvalId: 1,
        kind: 'send',
        projectId: ctx.projectId,
        agentId: null,
        issueId: null,
        runId: null,
      },
    });
    const kept = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await publishBusEvent(event(kept), tx);
    });
    expect(await stored(kept)).toEqual([`event:${kept}`, `worker-event:${kept}`]);
    const lost = crypto.randomUUID();
    await db
      .transaction(async (tx) => {
        await publishBusEvent(event(lost), tx);
        tx.rollback();
      })
      .catch(() => {});
    expect(await stored(lost)).toEqual([]);
  });
});

describe('engine settings', () => {
  it('reads the default time zone and lets the instance owner set it', async () => {
    const ctx = await setupProject();
    const before = (await ctx.asOwner['workflow-engine'].settings.get()).data!;
    expect(before.defaultTimezone).toBeTruthy();
    const types = (await ctx.asOwner['workflow-engine'].types.get()).data!;
    expect(types.steps.map((step) => step.type)).toEqual(
      expect.arrayContaining(['agent', 'approval', 'notify', 'webhook', 'delegate', 'agent_team']),
    );
    expect(types.triggers.find((trigger) => trigger.type === 'schedule')?.scheduled).toBe(true);
    // The project's owner is the instance's first user, its owner (god).
    const god = ctx.asOwner.god.engine;
    const set = (await god.put({ defaultTimezone: 'America/New_York' })).data!;
    expect(set).toMatchObject({ defaultTimezone: 'America/New_York', timezoneSet: true });
    expect((await ctx.asOwner['workflow-engine'].settings.get()).data!.defaultTimezone).toBe(
      'America/New_York',
    );
    expect((await god.put({ defaultTimezone: 'Mars/Olympus' })).status).toBe(400);
    const reset = (await god.put({ defaultTimezone: null })).data!;
    expect(reset).toMatchObject({ timezoneSet: false, defaultTimezone: reset.serverTimezone });
  });
});
