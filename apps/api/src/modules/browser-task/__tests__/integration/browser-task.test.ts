import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { agentUsage, browserGatewayEvent, db, helenaBrowserTaskRun } from '@repo/db';
import { eq } from 'drizzle-orm';

// browser_task's Helena side (docs/helena-decisions/browser-task.md): decision model connections
// in Zugänge, "Verbindung testen", the project's "Browser-Steuerung" and the instance default,
// the internal task routes the gateway calls (start, System One, progress, finish), the usage
// ledger, the jev-browser proxy, and Browser 2.0's runs.

const GATEWAY_TOKEN = 'test-browser-gateway-token-0123456789abcdef0123';
const BACKEND_KEY = 'mock-backend-key-0123456789';

// A Jev-compatible server on loopback: a model list and one fixed answer per question type.
let backend: Server;
let backendUrl = '';
const received: { auth: string | undefined; body: unknown }[] = [];

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-task-'));
  const file = join(directory, 'token');
  writeFileSync(file, GATEWAY_TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
  // No browser router in tests: Browser 2.0's decision runs report that.
  process.env.HELENA_BROWSER_ROUTER_URL = 'http://127.0.0.1:9';
  backend = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${BACKEND_KEY}`)
      return send(401, { detail: 'no' });
    if (request.url === '/v1/models') return send(200, { models: [{ name: 'mock-1' }] });
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => {
      const body = JSON.parse(data) as {
        questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
      };
      received.push({ auth: request.headers.authorization, body });
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(body.questions)) {
        if (question.type === 'noul') answers[id] = { type: 'noul', noul: 0.9 };
        else {
          const keys = Object.keys(question.criteria ?? {});
          answers[id] = {
            type: 'choice',
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
            confidence: 1,
          };
        }
      }
      send(200, { model: 'mock-1', answers, usage: { input_tokens: 120, output_tokens: 3 } });
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
});

afterAll(() => backend?.close());

function internal(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Surfer',
    username: 'surfer',
    kind: 'external',
  });
  const agent = created.data!.agent;
  const servers = (await asOwner.teams({ teamId: mkt.teamId })['mcp-servers'].get()).data!;
  const gateway = servers.find((row) => row.name === 'projekt-browser')!;
  await asOwner
    .teams({ teamId: mkt.teamId })
    ['ai-agents']({ agentId: agent.id })
    ['mcp-servers'].put({
      mcpServerIds: [gateway.id],
    });
  return { owner, asOwner, mkt, agent, apiKey: created.data!.apiKey! as string };
}

async function connection(asOwner: Api, teamId: number, overrides: Record<string, unknown> = {}) {
  const res = await asOwner.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Laya (Test)',
    provider: 'compatible',
    baseUrl: `${backendUrl}/v1/systemone`,
    model: 'mock-1',
    allowPrivateAddress: true,
    value: BACKEND_KEY,
    ...overrides,
  } as never);
  return res;
}

describe('decision model connections', () => {
  beforeEach(resetDb);

  it('stores a connection with its address and model, and never returns the key', async () => {
    const { asOwner, mkt } = await setup();
    const res = await connection(asOwner, mkt.teamId);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      kind: 'decision_model',
      provider: 'compatible',
      baseUrl: backendUrl,
      model: 'mock-1',
      allowPrivateAddress: true,
      keySource: 'stored',
      secrets: ['value'],
    });
    expect(JSON.stringify(res.data)).not.toContain(BACKEND_KEY);
  });

  it('refuses a TypeSafe connection without a key and an unknown kind of service', async () => {
    const { asOwner, mkt } = await setup();
    expect(
      (
        await connection(asOwner, mkt.teamId, {
          provider: 'typesafe',
          baseUrl: undefined,
          value: undefined,
        })
      ).status,
    ).toBe(400);
    expect((await connection(asOwner, mkt.teamId, { provider: 'nope' })).status).toBe(400);
  });

  it('tests a connection and stores the result as its status', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const test = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(test.data).toMatchObject({ ok: true, message: 'ok', models: ['mock-1'] });
    const listed = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials.get({ query: { kind: 'decision_model' } });
    expect(listed.data?.items[0]?.status).toBe('ok');
  });

  it('refuses a local address the owner did not allow for this connection', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId, { allowPrivateAddress: false })).data!;
    const test = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(test.data).toMatchObject({ ok: false, message: 'address_not_allowed' });
  });

  it('lists the kinds of decision service with their defaults', async () => {
    const { asOwner } = await setup();
    const res = await asOwner['decision-backends'].get();
    const ids = res.data!.backends.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['typesafe', 'vercel', 'compatible']));
    const typesafe = res.data!.backends.find((b) => b.id === 'typesafe')!;
    expect(typesafe).toMatchObject({
      defaultBaseUrl: 'https://api.typesafe.ai',
      defaultModel: 'jev-latest',
      keyRequired: true,
    });
    const vercel = res.data!.backends.find((b) => b.id === 'vercel')!;
    expect(vercel).toMatchObject({
      defaultBaseUrl: 'https://ai-gateway.vercel.sh/typesafe',
      defaultModel: 'typesafe-ai/jev',
    });
  });
});

describe('browser control and the task routes', () => {
  beforeEach(resetDb);

  async function withDecisionModel() {
    const ctx = await setup();
    const created = (await connection(ctx.asOwner, ctx.mkt.teamId)).data!;
    const put = await ctx.asOwner.projects({ projectKey: 'MKT' }).settings['browser-control'].put({
      mode: 'decision',
      credentialId: created.id,
    });
    expect(put.status).toBe(200);
    return { ...ctx, credentialId: created.id };
  }

  it('offers browser_task only where the project has a decision model', async () => {
    const { asOwner, apiKey } = await setup();
    const standard = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(standard.browserTask).toMatchObject({ enabled: false });
    const refused = await internal('/internal/browser-gateway/task/start', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      kind: 'task',
      goal: 'x',
    });
    expect(refused.status).toBe(409);
    void asOwner;
  });

  it('runs a task: start, System One with the key, steps, result, ledger', async () => {
    const { apiKey, agent } = await withDecisionModel();
    const resolved = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(resolved.browserTask).toMatchObject({
      enabled: true,
      policy: 'laya',
      label: 'Laya (Test)',
    });

    const started = await internal('/internal/browser-gateway/task/start', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      kind: 'task',
      goal: 'Open the contact page',
      mode: 'act',
      maxSteps: 5,
    });
    expect(started.status).toBe(200);
    const task = (await started.json()) as { taskToken: string; policy: string; model: string };
    expect(task).toMatchObject({ policy: 'laya', model: 'mock-1' });

    const answer = await internal('/internal/browser-gateway/systemone', {
      taskToken: task.taskToken,
      state: { page: { text: 'Hallo' } },
      questions: { done: { type: 'noul', instructions: 'Done?' } },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      model: 'mock-1',
      answers: { done: { noul: 0.9 } },
      inputTokens: 120,
    });
    expect(received.at(-1)?.auth).toBe(`Bearer ${BACKEND_KEY}`);

    const progress = await internal('/internal/browser-gateway/task/progress', {
      taskToken: task.taskToken,
      step: {
        n: 1,
        operation: 'CLICK',
        element: 'link "Kontakt"',
        category: 'write',
        probability: 0.9,
        value: 'secret',
      },
    });
    expect(await progress.json()).toEqual({ cancelled: false });

    await internal('/internal/browser-gateway/task/finish', {
      taskToken: task.taskToken,
      result: {
        status: 'done',
        summary: 'Done: Open the contact page',
        url: 'https://x.test/kontakt',
        durationMs: 1234,
        usage: { calls: 1 },
      },
    });
    const [row] = await db.select().from(helenaBrowserTaskRun);
    expect(row).toMatchObject({
      status: 'done',
      decisions: 1,
      inputTokens: 120,
      source: 'agent',
      provider: 'local',
      modelReported: 'mock-1',
    });
    expect(JSON.stringify(row!.steps)).not.toContain('secret');
    const ledger = await db.select().from(agentUsage).where(eq(agentUsage.agentId, agent.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: 'tool',
      runtime: 'browser-gateway',
      provider: 'local',
      inputTokens: 120,
    });
    const events = await db.select().from(browserGatewayEvent);
    expect(
      events.some((event) => event.tool === 'browser_task' && event.category === 'write'),
    ).toBe(true);

    // The token stops working with the task.
    const late = await internal('/internal/browser-gateway/systemone', {
      taskToken: task.taskToken,
      state: 'x',
      questions: { done: { type: 'noul', instructions: 'Done?' } },
    });
    expect(late.status).toBe(404);
  });

  it('serves jev-browser through the proxy on loopback only, under the run token', async () => {
    const { apiKey } = await withDecisionModel();
    const task = (await (
      await internal('/internal/browser-gateway/task/start', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
        goal: 'x',
      })
    ).json()) as { taskToken: string };
    const call = (headers: Record<string, string>) =>
      app.handle(
        new Request('http://localhost/internal/systemone/v1/systemone', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({
            model: 'jev-latest',
            state: 'x',
            questions: { q: { type: 'noul', instructions: 'Y?' } },
          }),
        }),
      );
    const ok = await call({ authorization: `Bearer ${task.taskToken}` });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      answers: { q: { noul: 0.9 } },
      usage: { input_tokens: 120 },
    });
    expect((await call({ authorization: 'Bearer nope-nope-nope-nope-nope-nope' })).status).toBe(
      401,
    );
    expect(
      (await call({ authorization: `Bearer ${task.taskToken}`, 'x-real-ip': '192.168.1.5' }))
        .status,
    ).toBe(404);
  });

  it('follows the instance default when the project inherits', async () => {
    const { asOwner, mkt, apiKey } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const set = await asOwner.god['browser-control'].put({
      mode: 'decision',
      credentialId: created.id,
      policy: 'jev',
    });
    expect(set.status).toBe(200);
    const view = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-control'].get();
    expect(view.data).toMatchObject({
      setting: { mode: 'inherit' },
      effective: { enabled: true, source: 'instance', policy: 'jev', credentialId: created.id },
    });
    const resolved = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(resolved.browserTask).toMatchObject({ enabled: true, policy: 'jev' });
  });
});

describe('Browser 2.0', () => {
  beforeEach(resetDb);

  it('offers the project agents with the browser and the connections', async () => {
    const { asOwner, agent, mkt } = await setup();
    await connection(asOwner, mkt.teamId);
    const options = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].options.get();
    expect(options.data?.agents.map((a) => a.id)).toEqual([agent.id]);
    expect(options.data?.connections).toHaveLength(1);
    expect(options.data?.slug).toBe('mkt');
  });

  it('starts a Standard run as a chat message to the agent', async () => {
    const { asOwner, agent } = await setup();
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'standard',
      agentId: agent.id,
      goal: 'Öffne die Kontakt-Seite',
      values: { name: 'Ada' },
    });
    expect(run.status).toBe(200);
    expect(run.data).toMatchObject({ backend: 'standard', status: 'running', valueKeys: ['name'] });
    expect(run.data?.chatThreadId).toBeTruthy();
    const listed = await asOwner
      .projects({ projectKey: 'MKT' })
      ['browser-lab'].runs.get({ query: {} });
    expect(listed.data?.runs).toHaveLength(1);
    const cancelled = await asOwner
      .projects({ projectKey: 'MKT' })
      ['browser-lab'].runs({ runId: run.data!.id })
      .cancel.post();
    expect(cancelled.data?.status).toBe('cancelled');
  });

  it('reports a decision run the browser router could not start', async () => {
    const { asOwner, agent, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'decision',
      agentId: agent.id,
      credentialId: created.id,
      goal: 'Öffne die Kontakt-Seite',
    });
    expect(run.status).toBe(200);
    expect(run.data).toMatchObject({ backend: 'decision', status: 'error', policy: 'laya' });
  });

  it('refuses an agent without the project browser', async () => {
    const { asOwner } = await setup();
    const other = await createAgent(asOwner, 'MKT', {
      name: 'Plain',
      username: 'plain',
      kind: 'external',
    });
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'standard',
      agentId: other.data!.agent.id,
      goal: 'x',
    });
    expect(run.status).toBe(400);
  });
});
