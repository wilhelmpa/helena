import { afterAll, afterEach, beforeAll, beforeEach, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentChatMessage,
  db,
  helenaBrowserTaskRun,
  helenaDecisionEval,
  projectMember,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { BROWSER_CLASS } from '#modules/decisions/classes';
import {
  firstStagePolicy,
  firstStageView,
  stageCircuitResult,
} from '#modules/decisions/first-stage';
import * as browserPolicy from '#modules/agent-browser-gateway/policy';
import { getInstanceBrowserControl, effectiveBrowserControl } from '../../settings';

const TOKEN = 'synthetic-jev-browser-gateway-token-0123456789';
let server: ReturnType<typeof Bun.serve>;
let calls = 0;
let localCalls = 0;
let behavior: 'normal' | 'error' | 'held' = 'normal';
let release: (() => void) | undefined;
let held: Promise<void> | undefined;
beforeAll(() => {
  const folder = mkdtempSync(join(tmpdir(), 'jev-native-stage-'));
  const file = join(folder, 'token');
  writeFileSync(file, TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith('/chat/completions')) {
        localCalls++;
        return Response.json({
          model: 'local-logit-fixture',
          usage: { prompt_tokens: 2, completion_tokens: 1 },
          choices: [
            {
              message: { content: 'A' },
              logprobs: {
                content: [
                  {
                    top_logprobs: [
                      { token: 'A', logprob: Math.log(0.999) },
                      { token: 'B', logprob: Math.log(0.001) },
                    ],
                  },
                ],
              },
            },
          ],
        });
      }
      calls++;
      if (behavior === 'held') await held;
      if (behavior === 'error')
        return Response.json({ detail: 'Synthetic error' }, { status: 402 });
      return Response.json({
        model: 'jev-test',
        answers: { q: { type: 'noul', noul: 0.99 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
});
afterAll(() => server.stop(true));
beforeEach(async () => {
  await resetDb();
  calls = 0;
  localCalls = 0;
  behavior = 'normal';
});
afterEach(() => {
  release?.();
  held = undefined;
  release = undefined;
});

const internal = (path: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost/internal/browser-gateway/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    }),
  );

async function setup(enabled = true) {
  const api = authedApi((await signUpTestUser()).cookie);
  const project = (await api.projects.post({ key: 'JEVBR', name: 'Synthetic browser stage' }))
    .data!;
  const teamId = project.teamId;
  const created = (
    await createAgent(api, 'JEVBR', {
      name: 'Browser stage',
      username: 'browser-stage',
      kind: 'external',
    })
  ).data!;
  const agent = created.agent;
  const servers = (await api.teams({ teamId })['mcp-servers'].get()).data!;
  const gateway = servers.find((entry) => entry.name === 'projekt-browser')!;
  await api
    .teams({ teamId })
    ['ai-agents']({ agentId: agent.id })
    ['mcp-servers'].put({ mcpServerIds: [gateway.id] });
  const credential = await api.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Synthetic JEV',
    provider: 'typesafe',
    model: 'jev-test',
    baseUrl: `http://127.0.0.1:${server.port}`,
    allowPrivateAddress: true,
    value: 'synthetic-jev-key',
  });
  expect(credential.status).toBe(201);
  const credentialId = credential.data!.id;
  stageCircuitResult(teamId, credentialId, true);
  await db.insert(helenaDecisionEval).values({
    teamId,
    classId: BROWSER_CLASS,
    credentialId,
    backendLabel: 'synthetic',
    threshold: 0.95,
    questions: 6,
    answered: 6,
    correct: 6,
    correctAnswered: 6,
    precision: 1,
    coverage: 1,
    accuracy: 1,
    passed: true,
    finishedAt: new Date(),
  });
  const policy = api.teams({ teamId }).decisions['first-stage'];
  expect(
    (
      await policy.patch({
        credentialId,
        timeoutMs: 1000,
        useCases: { [BROWSER_CLASS]: { enabled: true, cloudAllowed: true } },
      })
    ).status,
  ).toBe(200);
  if (enabled) expect((await policy.patch({ enabled: true })).status).toBe(200);
  const sent = (
    await api
      .projects({ projectKey: 'JEVBR' })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Synthetic page only.' })
  ).data!;
  const chat = api.chats({ threadId: sent.threadId });
  const work = {
    agentKey: created.apiKey!,
    projectSlug: 'jevbr',
    via: 'jevbr',
    messageId: sent.messageId,
  };
  const start = (extra: Record<string, unknown> = {}) =>
    internal('task/start', {
      ...work,
      kind: 'task',
      goal: 'Inspect the synthetic fixture',
      mode: 'read',
      maxSteps: 1,
      ...extra,
    });
  return { api, project, teamId, agent, credentialId, policy, chat, work, start };
}

async function opened(fixture: Awaited<ReturnType<typeof setup>>) {
  const response = await fixture.start();
  expect(response.status).toBe(200);
  return (await response.json()) as { taskId: number; taskToken: string };
}
const ask = (taskToken: string) =>
  internal('systemone', {
    taskToken,
    state: 'Synthetic visible fixture only.',
    questions: { q: { type: 'noul', instructions: 'Is the fixture visible?' } },
  });

it('falls from a failed Jev call to configured local logits and logs both stages', async () => {
  const fixture = await setup();
  const local = await fixture.api.teams({ teamId: fixture.teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Synthetic local logits',
    provider: 'local-logit',
    model: 'local-logit-fixture',
    baseUrl: `http://127.0.0.1:${server.port}`,
    allowPrivateAddress: true,
    value: 'synthetic-local-key',
  });
  expect(local.status).toBe(201);
  expect(
    (
      await fixture.api
        .teams({ teamId: fixture.teamId })
        .decisions.classes({ classId: BROWSER_CLASS })
        .patch({ credentialId: local.data!.id })
    ).status,
  ).toBe(200);
  const task = await opened(fixture);
  behavior = 'error';
  const response = await ask(task.taskToken);
  expect(response.status).toBe(200);
  expect(calls).toBe(1);
  expect(localCalls).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({ model: 'local-logit-fixture' });
});
async function waitForCall() {
  const deadline = Date.now() + 1500;
  while (!calls && Date.now() < deadline) await Bun.sleep(5);
  expect(calls).toBe(1);
}

it('persists one policy, preserves defaults and selects the native optional stage only for inherited Standard', async () => {
  const fixture = await setup(false);
  const defaults = await getInstanceBrowserControl();
  expect(
    (await effectiveBrowserControl({ teamId: fixture.teamId, projectId: fixture.project.id }))
      .enabled,
  ).toBe(false);
  expect((await fixture.policy.patch({ enabled: true })).status).toBe(200);
  const stored = await firstStagePolicy(fixture.teamId);
  expect(stored.revision).toBeString();
  expect(await firstStagePolicy(fixture.teamId)).toEqual(stored);
  expect((await firstStageView(fixture.teamId)).effective[BROWSER_CLASS]?.enabled).toBe(true);
  expect(await getInstanceBrowserControl()).toEqual(defaults);
  const task = await opened(fixture);
  const [row] = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(eq(helenaBrowserTaskRun.id, task.taskId));
  expect(row?.firstStageScope).toMatchObject({ revision: stored.revision, chatRevision: 0 });
  expect((await ask(task.taskToken)).status).toBe(200);
  expect(calls).toBe(1);
  expect((await fixture.start()).status).toBe(409);
  expect(calls).toBe(1);
});

it('preserves explicit project control and an explicit caller model when the optional master is off', async () => {
  const fixture = await setup(false);
  await db
    .update(agentChatMessage)
    .set({ model: 'synthetic-explicit-model' })
    .where(eq(agentChatMessage.id, fixture.work.messageId));
  const settings = fixture.api.projects({ projectKey: 'JEVBR' }).settings['browser-control'];
  expect((await settings.put({ mode: 'standard' })).status).toBe(200);
  await fixture.policy.patch({ enabled: true });
  expect((await fixture.start()).status).toBe(409);
  expect(
    (await settings.put({ mode: 'decision', credentialId: fixture.credentialId, policy: 'jev' }))
      .status,
  ).toBe(200);
  await fixture.policy.patch({ enabled: false });
  const task = await opened(fixture);
  const [row] = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(eq(helenaBrowserTaskRun.id, task.taskId));
  expect(row?.firstStageScope).toBeNull();
  expect((await ask(task.taskToken)).status).toBe(200);
  const [message] = await db
    .select({ model: agentChatMessage.model })
    .from(agentChatMessage)
    .where(eq(agentChatMessage.id, fixture.work.messageId));
  expect(message?.model).toBe('synthetic-explicit-model');
});

for (const toggle of ['master', 'browser', 'chat', 'off-on'] as const) {
  it(`revokes held native inference after ${toggle} and never retries the optional stage`, async () => {
    const fixture = await setup();
    const task = await opened(fixture);
    behavior = 'held';
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = ask(task.taskToken);
    try {
      await waitForCall();
      const started = Date.now();
      if (toggle === 'chat') await fixture.chat.patch({ jevFirstStage: 'off' });
      else if (toggle === 'browser')
        await fixture.policy.patch({
          useCases: { [BROWSER_CLASS]: { enabled: false, cloudAllowed: false } },
        });
      else {
        await fixture.policy.patch({ enabled: false });
        if (toggle === 'off-on') await fixture.policy.patch({ enabled: true });
      }
      expect((await pending).status).toBe(409);
      expect(Date.now() - started).toBeLessThan(1000);
      expect((await ask(task.taskToken)).status).toBe(409);
      expect(calls).toBe(1);
    } finally {
      release?.();
      await pending;
    }
  });
}

for (const failure of ['error', 'held'] as const) {
  it(`bounds native ${failure} and preserves the recorded page actions for handback`, async () => {
    const fixture = await setup();
    await fixture.policy.patch({ timeoutMs: 200 });
    const task = await opened(fixture);
    await internal('task/progress', {
      taskToken: task.taskToken,
      step: {
        n: 1,
        operation: 'CLICK',
        element: 'Synthetic fixture',
        category: 'read',
        outcome: 'applied',
      },
    });
    behavior = failure;
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = Date.now();
    try {
      expect((await ask(task.taskToken)).status).toBe(409);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(calls).toBe(1);
      const [row] = await db
        .select()
        .from(helenaBrowserTaskRun)
        .where(eq(helenaBrowserTaskRun.id, task.taskId));
      expect(row?.steps).toHaveLength(1);
      expect((await ask(task.taskToken)).status).toBe(409);
      expect(calls).toBe(1);
      expect((await fixture.start()).status).toBe(409);
    } finally {
      release?.();
    }
  });
}

it('rejects a changed connection before native dispatch', async () => {
  const fixture = await setup();
  const task = await opened(fixture);
  await fixture.api
    .teams({ teamId: fixture.teamId })
    .credentials({ credentialId: fixture.credentialId })
    .patch({ model: 'changed-synthetic-model' });
  expect((await ask(task.taskToken)).status).toBe(409);
  expect(calls).toBe(0);
});

it('rejects revoked project membership before native dispatch', async () => {
  const fixture = await setup();
  const task = await opened(fixture);
  await db
    .delete(projectMember)
    .where(
      and(
        eq(projectMember.projectId, fixture.project.id),
        eq(projectMember.userId, fixture.agent.userId),
      ),
    );
  expect((await ask(task.taskToken)).status).toBe(409);
  expect(calls).toBe(0);
});

it('keeps another team, project and foreign chat outside the optional stage', async () => {
  const fixture = await setup();
  const stranger = authedApi((await signUpTestUser()).cookie);
  const foreign = (await stranger.projects.post({ key: 'FOREIGN', name: 'Foreign synthetic' }))
    .data!;
  expect(
    (
      await stranger
        .teams({ teamId: fixture.teamId })
        .decisions['first-stage'].patch({ enabled: false })
    ).status,
  ).toBe(404);
  expect((await fixture.start({ projectSlug: 'foreign' })).status).toBe(403);
  expect((await fixture.start({ messageId: 999999 })).status).toBe(409);
  expect(
    (await effectiveBrowserControl({ teamId: foreign.teamId, projectId: foreign.id })).enabled,
  ).toBe(false);
  expect(calls).toBe(0);
});

it('denies a held action-policy result when the stage was disabled before its allow returned', async () => {
  const fixture = await setup();
  const task = await opened(fixture);
  let entered!: () => void;
  let resume!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const decision = spyOn(browserPolicy, 'decideBrowserAction').mockImplementation(async () => {
    entered();
    await paused;
    return { effect: 'allow', reason: 'Synthetic allowed action' };
  });
  const pending = internal('decide', {
    ...fixture.work,
    taskToken: task.taskToken,
    tool: 'browser_task',
    category: 'write',
    context: { origin: 'https://synthetic.test', target: 'TYPE_TEXT Name' },
  });
  try {
    await Promise.race([
      reached,
      Bun.sleep(1500).then(() => {
        throw new Error('Policy was not reached');
      }),
    ]);
    await fixture.policy.patch({ enabled: false });
    resume();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ effect: 'deny' });
    expect(calls).toBe(0);
  } finally {
    resume();
    await pending;
    decision.mockRestore();
  }
});

it('does not accept late success or erase applied steps after optional stage revocation', async () => {
  const fixture = await setup();
  const task = await opened(fixture);
  await internal('task/progress', {
    taskToken: task.taskToken,
    step: {
      n: 1,
      operation: 'CLICK',
      element: 'Synthetic fixture',
      category: 'read',
      outcome: 'applied',
    },
  });
  await fixture.policy.patch({ enabled: false });
  const finished = await internal('task/finish', {
    taskToken: task.taskToken,
    result: { status: 'done', steps: [], summary: 'Late synthetic success' },
  });
  expect(finished.status).toBe(200);
  const [row] = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(eq(helenaBrowserTaskRun.id, task.taskId));
  expect(row?.status).toBe('cancelled');
  expect(row?.steps).toHaveLength(1);
  expect(row?.finishedAt).not.toBeNull();
  expect(calls).toBe(0);
});
