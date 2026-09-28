import { describe, it, expect, beforeEach } from 'bun:test';
import { db, agentChatThread, agentUsage, aiAgent } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { scheduleCuratorRuns } from '../../../runtime-requests/curator-schedule';

// Glass-box runs: Helena asks an agent's runtime through its runner (sessions, transcripts,
// logs), stores a run's timeline while it runs, records what every run spent in the token
// ledger, continues a finished run's session, and holds all work during the emergency stop.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
  });
  const agent = created.data!.agent;
  return {
    asOwner,
    columnId,
    teamId: view.data!.project.teamId,
    projectId: view.data!.project.id,
    agent,
    apiKey: created.data!.apiKey!,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

async function queueRun(asOwner: Api, columnId: number, username: string) {
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Landing page' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `please review @${username}` });
  return issue;
}

const agentRoute = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId });

// The runner's side of one request: claim it, then answer.
async function answerNext(asRunner: Api, answer: (request: { op: string }) => unknown) {
  for (let i = 0; i < 50; i++) {
    const claimed = (await asRunner['agent-runtime'].requests.claim.post()).data!.request;
    if (claimed) {
      const result = answer(claimed.request);
      await asRunner['agent-runtime']
        .requests({ requestId: claimed.id })
        .answer.post(
          result instanceof Error ? { ok: false, error: result.message } : { ok: true, result },
        );
      return claimed;
    }
  }
  throw new Error('no request arrived');
}

const page = {
  sessions: [
    {
      id: '20260924_102846_e310ba',
      title: 'Bitte probiere einen Befehl aus',
      preview: 'Bitte probiere einen Befehl aus',
      source: 'tool',
      model: 'fake-model',
      startedAt: 1790238536024,
      endedAt: 1790238536493,
      lastActiveAt: 1790238536468,
      endReason: 'cli_close',
      messageCount: 4,
      toolCallCount: 1,
      usage: {
        inputTokens: 2400,
        outputTokens: 80,
        cacheReadTokens: 1600,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      estimatedCostUsd: 0,
      parentSessionId: null,
    },
  ],
  total: 1,
};

describe('runtime requests', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reads an agent's sessions through its runner", async () => {
    const { asOwner, asRunner, teamId, agent } = await setup();
    // The runner has been seen (its claim marks it present).
    await asRunner['agent-runs'].claim.post();
    const asking = agentRoute(asOwner, teamId, agent.id).runtime.sessions.get({
      query: { limit: 10 },
    });
    const claimed = await answerNext(asRunner, () => page);
    expect(claimed.request as unknown).toEqual({ op: 'sessions.list', limit: 10, offset: 0 });
    const res = await asking;
    expect(res.status).toBe(200);
    expect(res.data!.page!.sessions[0]!.id).toBe('20260924_102846_e310ba');
  });

  it("shows a person only their own chats' sessions and names each session's run", async () => {
    const { asOwner, asRunner, teamId, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'success', output: 'done', sessionId: 'sess-run' },
      { query: { claim: run.claim } },
    );
    const other = await signUpTestUser({ name: 'Other' });
    await db.insert(agentChatThread).values({
      id: 'thread-other',
      agentId: agent.id,
      userId: other.userId,
      title: 'Private chat',
      cliSessionId: 'sess-chat',
    });
    const summary = page.sessions[0]!;
    const listing = agentRoute(asOwner, teamId, agent.id).runtime.sessions.get({ query: {} });
    await answerNext(asRunner, () => ({
      sessions: [
        { ...summary, id: 'sess-run' },
        { ...summary, id: 'sess-chat' },
        { ...summary, id: 'sess-cli', source: 'cli' },
      ],
      total: 3,
    }));
    const res = await listing;
    expect(res.data!.page!.total).toBe(2);
    expect(
      res.data!.page!.sessions.map((session) => [session.id, session.link?.runId ?? null]),
    ).toEqual([
      ['sess-run', run.id],
      ['sess-cli', null],
    ]);
    expect(res.data!.page!.sessions[0]!.link!.issueIdentifier).toBe('MKT-1');
    // The other person's chat is not there to read either.
    const transcript = await agentRoute(asOwner, teamId, agent.id)
      .runtime.sessions({ sessionId: 'sess-chat' })
      .get({ query: {} });
    expect(transcript.status).toBe(404);
  });

  it("passes the runtime's refusal on and names a missing session", async () => {
    const { asOwner, asRunner, teamId, agent } = await setup();
    await asRunner['agent-runs'].claim.post();
    const asking = agentRoute(asOwner, teamId, agent.id)
      .runtime.sessions({ sessionId: 'nope' })
      .get({ query: {} });
    await answerNext(asRunner, () => new Error('Session not found'));
    expect((await asking).status).toBe(404);
  });

  it('answers 503 at once when the runner is offline', async () => {
    const { asOwner, teamId, agent } = await setup();
    await db.update(aiAgent).set({ lastSeenAt: null }).where(eq(aiAgent.id, agent.id));
    const res = await agentRoute(asOwner, teamId, agent.id).runtime.logs.get({ query: {} });
    expect(res.status).toBe(503);
  });

  it('pins a skill through the runner and asks enabled curators for their weekly review', async () => {
    const { asOwner, asRunner, teamId, agent } = await setup();
    await asRunner['agent-runs'].claim.post();
    const pinning = agentRoute(asOwner, teamId, agent.id).runtime.curator.post({
      action: 'pin',
      skill: 'release-notes',
    });
    const claimed = await answerNext(asRunner, () => ({
      paused: false,
      report: 'curator: ENABLED',
    }));
    expect(claimed.request as unknown).toEqual({
      op: 'curator.set',
      action: 'pin',
      skill: 'release-notes',
    });
    expect((await pinning).data).toEqual({ paused: false, report: 'curator: ENABLED' });
    // A name that reads as an option never reaches the runner.
    const bad = await agentRoute(asOwner, teamId, agent.id).runtime.curator.post({
      action: 'pin',
      skill: '--all',
    });
    expect(bad.status).toBe(400);

    // The curator is off: nothing is scheduled. On, with the capability, one review a week.
    expect(await scheduleCuratorRuns()).toBe(0);
    await db
      .update(aiAgent)
      .set({
        runtimePolicy: sql`${aiAgent.runtimePolicy} || '{"curator": true}'::jsonb`,
        runtimeState: sql`jsonb_set(coalesce(${aiAgent.runtimeState}, '{}'::jsonb), '{capabilities}', '["curator"]')`,
        lastSeenAt: new Date(),
      })
      .where(eq(aiAgent.id, agent.id));
    const now = new Date();
    expect(await scheduleCuratorRuns(now)).toBe(1);
    expect(await scheduleCuratorRuns(new Date(now.getTime() + 3_600_000))).toBe(0);
    const review = await answerNext(asRunner, () => ({ report: 'reviewed' }));
    expect(review.request as unknown).toEqual({ op: 'curator.run' });
    expect(await scheduleCuratorRuns(new Date(now.getTime() + 8 * 86_400_000))).toBe(1);
  });

  it("never shows an agent another agent's transcripts", async () => {
    const { asOwner, asRunner, teamId, agent } = await setup();
    await asRunner['agent-runs'].claim.post();
    const res = await agentRoute(asRunner, teamId, agent.id).runtime.sessions.get({ query: {} });
    expect([403, 404]).toContain(res.status);
    expect(asOwner).toBeDefined();
  });
});

describe('run timeline and usage', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reports outputs through MCP and infers file and PR results from tool calls', async () => {
    const { asOwner, asRunner, apiKey, teamId, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const mcp = await app.handle(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'report_output',
            arguments: {
              runId: run.id,
              kind: 'preview',
              title: 'Preview',
              target: 'https://preview.example.test/page',
            },
          },
        }),
      }),
    );
    expect(mcp.status).toBe(200);
    const body = await mcp.text();
    expect(body).toContain('"ok":true');
    const events = [
      { type: 'TOOL_CALL_START', toolCallId: 'file', toolCallName: 'Write' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'file', delta: '{"file_path":"docs/result.md"}' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'file', content: 'Wrote file' },
      { type: 'TOOL_CALL_START', toolCallId: 'patch', toolCallName: 'functions.apply_patch' },
      {
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'patch',
        delta: JSON.stringify({
          patch: '*** Begin Patch\n*** Add File: docs/codex.md\n*** End Patch',
        }),
      },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'patch', content: 'Patch applied' },
      { type: 'TOOL_CALL_START', toolCallId: 'pr', toolCallName: 'terminal' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'pr', delta: '{"command":"gh pr create"}' },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'pr',
        content: 'https://github.com/example/repo/pull/42',
      },
    ];
    const ack = await asRunner['agent-runs']({ runId: run.id }).events.post(
      { events },
      { query: { claim: run.claim } },
    );
    expect(ack.status).toBe(200);
    const detail = await agentRoute(asOwner, teamId, agent.id).runs({ runId: run.id }).get();
    expect(detail.status).toBe(200);
    expect(detail.data!.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'preview', title: 'Preview', source: 'reported' }),
        expect.objectContaining({ kind: 'file', target: 'docs/result.md', source: 'inferred' }),
        expect.objectContaining({ kind: 'file', target: 'docs/codex.md', source: 'inferred' }),
        expect.objectContaining({ kind: 'pr', target: 'https://github.com/example/repo/pull/42' }),
      ]),
    );
    const invalid = await asRunner['agent-runs']({ runId: run.id }).outputs.post({
      kind: 'preview',
      title: 'Unsafe',
      target: 'javascript:alert(1)',
    });
    expect(invalid.status).toBe(400);
    const screenshot = await asRunner['agent-runs']({ runId: run.id }).outputs.post({
      kind: 'screenshot',
      title: 'Landing page',
      target: 'screenshots/landing.png',
    });
    expect(screenshot.status).toBe(200);
    await asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'success', output: 'Landing page ready' },
      { query: { claim: run.claim } },
    );
    const finished = await agentRoute(asOwner, teamId, agent.id).runs({ runId: run.id }).get();
    expect(finished.data).toMatchObject({
      output: 'Landing page ready',
      outputs: expect.arrayContaining([
        expect.objectContaining({ kind: 'preview' }),
        expect.objectContaining({ kind: 'screenshot', target: 'screenshots/landing.png' }),
      ]),
    });
    const late = await asRunner['agent-runs']({ runId: run.id }).outputs.post({
      kind: 'file',
      title: 'Too late',
      target: 'docs/late.md',
    });
    expect(late.status).toBe(404);
  });

  it('stores the events of a run, records its spend and sums it by model', async () => {
    const { asOwner, asRunner, teamId, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const events = [
      { type: 'RUN_STARTED', threadId: `run-${run.id}`, runId: String(run.id) },
      { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'Ich probiere einen Befehl aus.' },
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'c1',
        toolCallName: 'terminal',
        parentMessageId: 'm',
      },
    ];
    const ack = await asRunner['agent-runs']({ runId: run.id }).events.post(
      { events },
      { query: { claim: run.claim } },
    );
    expect(ack.data).toEqual({ canceled: false });

    const timeline = await agentRoute(asOwner, teamId, agent.id)
      .runs({ runId: run.id })
      .events.get({ query: {} });
    expect(timeline.data!.events.map((e) => (e.payload as { type: string }).type)).toEqual([
      'RUN_STARTED',
      'THINKING_TEXT_MESSAGE_CONTENT',
      'TOOL_CALL_START',
    ]);
    const after = await agentRoute(asOwner, teamId, agent.id)
      .runs({ runId: run.id })
      .events.get({ query: { after: timeline.data!.next } });
    expect(after.data!.events).toEqual([]);

    await asRunner['agent-runs']({ runId: run.id }).result.post(
      {
        status: 'success',
        output: 'done',
        sessionId: 'sess-1',
        spend: {
          runtime: 'hermes',
          model: 'fake-model',
          provider: 'custom',
          inputTokens: 2400,
          outputTokens: 80,
          cacheReadTokens: 1600,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          durationMs: 9870,
        },
        runtime: {
          requested: { model: 'fake-model', reasoning: null },
          defaults: null,
          used: { model: 'other-model', reasoning: null, provider: 'custom' },
        },
      },
      { query: { claim: run.claim } },
    );

    const detail = await agentRoute(asOwner, teamId, agent.id).runs({ runId: run.id }).get();
    expect(detail.data).toMatchObject({
      status: 'success',
      sessionId: 'sess-1',
      usage: [{ kind: 'run', model: 'fake-model', inputTokens: 2400, cacheReadTokens: 1600 }],
      blockedQuestion: null,
      reflection: null,
      modelCheck: { configured: { model: 'fake-model', source: 'agent' }, mismatch: ['model'] },
    });

    const usage = await asOwner.teams({ teamId })['agent-usage'].get({
      query: { by: 'agent,model,day' },
    });
    expect(usage.status).toBe(200);
    expect(usage.data!.rows).toHaveLength(1);
    expect(usage.data!.rows[0]).toMatchObject({
      agentId: agent.id,
      model: 'fake-model',
      inputTokens: 2400,
      outputTokens: 80,
      entries: 1,
    });
    // Eden reads the YYYY-MM-DD day back as a date.
    expect(new Date(usage.data!.rows[0]!.day!).toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
    expect(usage.data!.total.inputTokens).toBe(2400);
    const rows = await db.select().from(agentUsage);
    expect(rows[0]).toMatchObject({ runId: run.id, sessionId: 'sess-1', durationMs: 9870 });
  });

  it("continues a finished run's session with a new instruction", async () => {
    const { asOwner, asRunner, teamId, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'success', output: 'first', sessionId: 'sess-7' },
      { query: { claim: run.claim } },
    );

    const res = await agentRoute(asOwner, teamId, agent.id)
      .runs({ runId: run.id })
      .continue.post({ instruction: 'Now write the tests too.' });
    expect(res.status).toBe(201);

    const next = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(next.id).toBe(res.data!.runId);
    expect(next.sessionId).toBe('sess-7');
    // Its first claim carries the owner's instruction, not the crash-resume prompt.
    expect(next.prompt).toContain('Now write the tests too.');
    expect(next.prompt).not.toContain('stopped before it finished');

    const again = await agentRoute(asOwner, teamId, agent.id)
      .runs({ runId: run.id })
      .continue.post({ instruction: 'And again' });
    expect(again.status).toBe(409);
  });
});

describe('emergency stop', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('holds every run while it is on and hands a running one back', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const on = await asOwner.god['emergency-stop'].put({ active: true, reason: 'Test' });
    expect(on.data).toMatchObject({ active: true, reason: 'Test' });
    expect((await asOwner['emergency-stop'].get()).data!.active).toBe(true);

    const beat = await asRunner['agent-runs']({ runId: run.id }).heartbeat.post(
      {},
      { query: { claim: run.claim } },
    );
    expect(beat.data).toEqual({ canceled: false, hold: true });

    await asRunner['agent-runs']({ runId: run.id }).release.post(
      {},
      { query: { claim: run.claim } },
    );
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();

    await asOwner.god['emergency-stop'].put({ active: false });
    expect((await asRunner['agent-runs'].claim.post()).data!.run!.id).toBe(run.id);
  });

  it('is switched by the instance owner only', async () => {
    await resetDb();
    await signUpTestUser({ name: 'Owner' });
    const other = await signUpTestUser({ name: 'Someone' });
    const res = await authedApi(other.cookie).god['emergency-stop'].put({ active: true });
    expect(res.status).toBe(403);
  });
});
