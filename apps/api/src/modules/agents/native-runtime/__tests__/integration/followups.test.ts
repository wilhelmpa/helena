import { afterEach, beforeEach, expect, test } from 'bun:test';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';

const envKeys = [
  'HELENA_NATIVE_RUNTIME',
  'AGENT_CHAT_CLAIM_WAIT_MS',
  'AGENT_CHAT_CLAIM_POLL_MS',
  'AGENT_CHAT_LEASE_SECONDS',
];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
beforeEach(async () => {
  process.env.HELENA_NATIVE_RUNTIME = 'on';
  process.env.AGENT_CHAT_CLAIM_WAIT_MS = '20';
  process.env.AGENT_CHAT_CLAIM_POLL_MS = '5';
  await resetDb();
});
afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});
async function setup(runtime: 'helena' | 'hermes' = 'helena') {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'VOL', name: 'Volition test' })).data!;
  const created = (
    await createAgent(api, 'VOL', {
      name: 'Test agent',
      username: 'testagent',
      kind: 'external',
      triggerOnMention: true,
      runtimePolicy: {
        runtime,
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
      },
    })
  ).data!;
  const agentId = created.agent.id;
  const runner = apiKeyApi(created.apiKey!);
  const chat = api.projects({ projectKey: 'VOL' })['ai-agents']({ agentId }).chat;
  const sent = (await chat.post({ prompt: 'Start' })).data!;
  const claim = await runner['agent-chats'].claim.post();
  expect(claim.data!.message!.id).toBe(sent.messageId);
  const session = (
    await runner['agent-runtime'].sessions.post({
      kind: 'chat',
      threadId: sent.threadId,
      model: 'test',
    })
  ).data!;
  return {
    owner,
    api,
    agentId,
    chat,
    sent,
    session,
    project,
    runner,
    followups: chat({ messageId: sent.messageId }).followups,
    boundary: {
      kind: 'chat' as const,
      id: sent.messageId,
      claim: claim.data!.message!.attempts!,
      sessionId: session.id,
      afterSeq: 0,
      step: 1,
    },
    finish: () =>
      runner['agent-chats']({ messageId: sent.messageId }).result.post(
        { status: 'success' },
        { query: { claim: claim.data!.message!.attempts! } },
      ),
  };
}
const instruction = (mode: 'inject' | 'after' | 'replace', prompt: string = mode) => ({
  id: crypto.randomUUID(),
  mode,
  prompt,
});

test('API advertises native modes, stores delivery atomically and rejects stale claims', async () => {
  const f = await setup();
  expect((await f.followups.get()).data!.modes).toEqual(['inject', 'after', 'replace']);
  const input = instruction('inject');
  expect((await f.followups.post(input)).data!.state).toBe('pending');
  expect((await f.followups.post(input)).data!.id).toBe(input.id);
  const delivered = await f.runner['agent-runtime'].followups.post(f.boundary);
  expect(delivered.status).toBe(200);
  expect(delivered.data!.items[0]!.message.content).toBe('inject');
  expect((await f.followups.get()).data!.items[0]).toMatchObject({
    state: 'applied',
    position: { sessionId: f.session.id, seq: 1, step: 1 },
  });
  expect(
    (await f.runner['agent-runtime'].sessions({ sessionId: f.session.id }).get()).data!.items,
  ).toHaveLength(1);
  expect((await f.runner['agent-runtime'].followups.post({ ...f.boundary, claim: 2 })).status).toBe(
    409,
  );
  expect(
    (await f.runner['agent-runtime'].followups.post({ ...f.boundary, afterSeq: 1 })).data!.items,
  ).toEqual([]);
  const outsider = await signUpTestUser();
  const refused = await authedApi(outsider.cookie)
    .projects({ projectKey: 'VOL' })
    ['ai-agents']({ agentId: f.agentId })
    .chat({ messageId: f.sent.messageId })
    .followups.post(instruction('after'));
  expect(refused.status).toBe(403);
});

test('other runtimes support only after, which executes successive turns in order', async () => {
  const f = await setup('hermes');
  expect((await f.followups.get()).data!.modes).toEqual(['after']);
  expect((await f.followups.post(instruction('inject'))).status).toBe(409);
  expect((await f.followups.post(instruction('replace'))).status).toBe(409);
  const first = instruction('after', 'first');
  const second = instruction('after', 'second');
  await f.followups.post(first);
  await f.followups.post(second);
  expect((await f.followups.get()).data!.items.every((i) => i.state === 'pending')).toBe(true);
  await f.finish();
  const next = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect(next.prompt).toContain('first');
  let rows = (await f.followups.get()).data!.items;
  expect(rows[0]!.nextId).toBe(next.id);
  expect(rows[1]!.state).toBe('pending');
  await f.runner['agent-chats']({ messageId: next.id }).result.post(
    { status: 'success' },
    { query: { claim: next.attempts! } },
  );
  const last = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect(last.prompt).toContain('second');
  rows = (await f.followups.get()).data!.items;
  expect(rows[1]!.nextId).toBe(last.id);
  expect((await f.followups.post(second)).data!.id).toBe(second.id);
});

test('response-end race queues an unconsumed instruction exactly once', async () => {
  const f = await setup();
  const input = instruction('inject');
  await Promise.all([f.followups.post(input), f.finish()]);
  const claims = await Promise.all([
    f.runner['agent-chats'].claim.post(),
    f.runner['agent-chats'].claim.post(),
  ]);
  const next = claims.flatMap((result) => (result.data!.message ? [result.data!.message] : []));
  expect(next).toHaveLength(1);
  expect((await f.followups.get()).data!.items[0]).toMatchObject({
    state: 'queued',
    nextId: next[0]!.id,
  });
});

test('stream reconnect replays instruction states without shifting runner offsets', async () => {
  const f = await setup();
  await f.followups.post(instruction('replace'));
  const answer = f.runner['agent-chats']({ messageId: f.sent.messageId });
  expect(
    (
      await answer.events.post({
        events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'old answer' }],
        delivery: { claim: 1, offset: 0 },
      })
    ).status,
  ).toBe(200);
  const before = (await f.chat({ messageId: f.sent.messageId }).events.get()).data!;
  await f.runner['agent-runtime'].followups.post(f.boundary);
  expect(
    (
      await answer.events.post({
        events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'new answer' }],
        delivery: { claim: 1, offset: 1 },
      })
    ).status,
  ).toBe(200);
  await f.finish();
  const response = await app.handle(
    new Request(
      `http://localhost/projects/VOL/ai-agents/${f.agentId}/chat/${f.sent.messageId}/stream`,
      { headers: { cookie: f.owner.cookie, 'last-event-id': String(before.items.at(-1)!.id) } },
    ),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('message_injected');
  expect(text).toContain('applied');
  expect(text).toContain('new answer');
  expect(text).not.toContain('old answer');
});

test('native reclaim preserves the session and durable instruction event', async () => {
  process.env.AGENT_CHAT_LEASE_SECONDS = '1';
  const f = await setup();
  await f.followups.post(instruction('inject'));
  await f.runner['agent-runtime'].followups.post(f.boundary);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const claimed = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect(claimed.sessionId).toBe(f.session.id);
  expect(claimed.attempts).toBe(2);
  const events = (await f.chat({ messageId: f.sent.messageId }).events.get()).data!.items;
  expect(
    events.filter((e) => (e.event as { name?: string }).name === 'message_injected'),
  ).toHaveLength(2);
  expect(
    (await f.runner['agent-runtime'].sessions({ sessionId: f.session.id }).get()).data!.items,
  ).toHaveLength(1);
});

test('run followups continue a claimed run and isolate access to its project', async () => {
  const f = await setup();
  const view = (await f.api.projects({ projectKey: 'VOL' }).get()).data!;
  const issue = (
    await f.api
      .projects({ projectKey: 'VOL' })
      .issues.post({ columnId: view.columns[0]!.id, title: 'Test run' })
  ).data!;
  await f.api.issues({ issueId: issue.id }).comments.post({ body: 'Please review @testagent' });
  const run = (await f.runner['agent-runs'].claim.post()).data!.run!;
  const followups = f.api
    .projects({ projectKey: 'VOL' })
    ['ai-agents']({ agentId: f.agentId })
    .runs({ runId: run.id }).followups;
  await followups.post(instruction('after', 'Continue the run'));
  await f.runner['agent-runs']({ runId: run.id }).result.post(
    { status: 'success' },
    { query: { claim: run.claim } },
  );
  const next = (await f.runner['agent-runs'].claim.post()).data!.run!;
  expect(next.prompt).toContain('Continue the run');
  expect((await followups.get()).data!.items[0]).toMatchObject({
    state: 'queued',
    nextId: next.id,
  });
});

test('later submissions to a completed answer join its successor queue', async () => {
  const f = await setup();
  await f.finish();
  const first = (await f.followups.post(instruction('after', 'first'))).data!;
  const second = (await f.followups.post(instruction('after', 'second'))).data!;
  expect(first.state).toBe('queued');
  expect(second.state).toBe('pending');
  const next = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect(next.id).toBe(first.nextId!);
  expect((await f.runner['agent-chats'].claim.post()).data!.message).toBeNull();
});

test('a competing ordinary send leaves followups waiting instead of creating parallel answers', async () => {
  const f = await setup();
  await f.followups.post(instruction('after'));
  await f.finish();
  const ordinary = (await f.chat.post({ threadId: f.sent.threadId, prompt: 'ordinary message' }))
    .data!;
  const next = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect(next.id).toBe(ordinary.messageId);
  expect((await f.followups.get()).data!.items[0]!.state).toBe('pending');
  await f.runner['agent-chats']({ messageId: next.id }).result.post(
    { status: 'success' },
    { query: { claim: next.attempts! } },
  );
  const last = (await f.runner['agent-chats'].claim.post()).data!.message!;
  expect((await f.followups.get()).data!.items[0]!.nextId).toBe(last.id);
});
