import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'bun:test';
import { db, setSetting, helenaDecision, helenaDecisionEval } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { classifyMessage } from '#modules/mail-triage/classify';
import { mailTriageConfig } from '#modules/mail-triage/config';
import { firstStageChatGuard } from '../../chat-stage';
import { resetDb } from '#tests/helpers/db';
import { GENERAL_CLASS, MAIL_CLASS } from '../../classes';
import { decide, useDecisionGate } from '../../service';
import { useLocalAiForDecisions } from '../../local-ai';
import { FIRST_STAGE_READINESS, stageCircuitResult, firstStagePolicy } from '../../first-stage';

const KEY = 'synthetic-stage-fixture-key';
const questions = {
  q: { kind: 'yesno' as const, question: 'Does the supplied text explicitly say yes?' },
};
type Behavior =
  | 'normal'
  | 'error'
  | 'network'
  | 'invalid'
  | 'low'
  | 'uncertain'
  | 'specialist'
  | 'wait'
  | 'wait-error';
let behavior: Record<string, Behavior> = {};
const calls: string[] = [];
const attemptCalls: { model: string; stage: boolean }[] = [];
let release: (() => void) | null = null;
let gate: Promise<void> | null = null;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        model: string;
        questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
      };
      calls.push(body.model);
      const stage = FIRST_STAGE_READINESS in body.questions;
      attemptCalls.push({ model: body.model, stage });
      const mode =
        behavior[`${body.model}:${stage ? 'stage' : 'regular'}`] ??
        behavior[body.model] ??
        'normal';
      if (['wait', 'wait-error'].includes(mode) && gate) await gate;
      if (mode === 'network') return new Response(null, { status: 503 });
      if (mode === 'error' || mode === 'wait-error')
        return Response.json({ detail: 'synthetic failure' }, { status: 402 });
      if (mode === 'invalid')
        return Response.json({ answers: { q: { type: 'noul', noul: 'invalid' } } });
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([id, question]) => {
          if (question.type === 'noul')
            return [id, { type: 'noul', noul: mode === 'low' ? 0.5 : 0.99 }];
          const options = Object.keys(question.criteria ?? {});
          const choice =
            id === FIRST_STAGE_READINESS && ['uncertain', 'specialist'].includes(mode)
              ? mode
              : id === 'task_eligibility'
                ? 'no_action'
                : options[0]!;
          return [
            id,
            {
              type: 'choice',
              choice,
              confidence: 0.99,
              probabilities: Object.fromEntries(
                options.map((key) => [key, key === choice ? 0.99 : 0.01 / (options.length - 1)]),
              ),
            },
          ];
        }),
      );
      return Response.json({
        model: body.model,
        answers,
        usage: { input_tokens: 10, output_tokens: 1 },
      });
    },
  });
});
afterAll(() => server.stop(true));
afterEach(() => {
  release?.();
  release = null;
  gate = null;
});
beforeEach(async () => {
  await resetDb();
  calls.length = 0;
  attemptCalls.length = 0;
  behavior = {};
});

async function passed(teamId: number, classId: string, credentialId: number) {
  await db.insert(helenaDecisionEval).values({
    teamId,
    classId,
    credentialId,
    backendLabel: 'fixture',
    threshold: 0.8,
    questions: 10,
    answered: 10,
    correct: 10,
    correctAnswered: 10,
    precision: 1,
    coverage: 1,
    accuracy: 1,
    passed: true,
    finishedAt: new Date(),
  });
}
async function connection(api: Api, teamId: number, model: string, provider = 'compatible') {
  const result = await api.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: model,
    provider,
    baseUrl: `http://127.0.0.1:${server.port}`,
    allowPrivateAddress: true,
    model,
    value: KEY,
  });
  expect(result.status).toBe(201);
  return result.data!.id;
}
async function setup(options: { stage?: boolean; fallback?: boolean; timeoutMs?: number } = {}) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'STAGE', name: 'Synthetic stage' })).data!;
  const teamId = project.teamId;
  const primary = await connection(api, teamId, 'primary');
  const jev = await connection(api, teamId, 'jev', 'typesafe');
  stageCircuitResult(teamId, jev, true);
  const fallback = options.fallback ? await connection(api, teamId, 'fallback') : null;
  for (const credentialId of [primary, jev]) await passed(teamId, GENERAL_CLASS, credentialId);
  expect(
    (
      await api
        .teams({ teamId })
        .decisions.classes({ classId: GENERAL_CLASS })
        .patch({
          enabled: true,
          credentialId: primary,
          fallbackCredentialId: fallback,
          threshold: 0.8,
          timeoutMs: options.timeoutMs ?? 1200,
        })
    ).status,
  ).toBe(200);
  expect(
    (
      await api.teams({ teamId }).decisions['first-stage'].patch({
        credentialId: jev,
        timeoutMs: 200,
        useCases: { [GENERAL_CLASS]: { enabled: true, cloudAllowed: true } },
      })
    ).status,
  ).toBe(200);
  if (options.stage !== false)
    expect(
      (await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: true })).status,
    ).toBe(200);
  const run = () =>
    decide({
      teamId,
      projectId: project.id,
      classId: GENERAL_CLASS,
      context: 'Yes. Synthetic evidence only.',
      questions,
    });
  return { api, teamId, project, primary, jev, fallback, run };
}

async function waitForStage() {
  const deadline = Date.now() + 1000;
  while (!calls.includes('jev') && Date.now() < deadline) await Bun.sleep(5);
  expect(calls).toContain('jev');
}

describe('optional Jev first decision stage', () => {
  it('off or per-use-case off leaves the existing path and assignments intact', async () => {
    const { api, teamId, primary, run } = await setup({ stage: false });
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary']);
    expect(
      (
        await api.teams({ teamId }).decisions['first-stage'].patch({
          enabled: true,
          useCases: { [GENERAL_CLASS]: { enabled: false, cloudAllowed: false } },
        })
      ).status,
    ).toBe(200);
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary', 'primary']);
    expect(
      (await api.teams({ teamId }).decisions.classes({ classId: GENERAL_CLASS }).get()).data!
        .setting.credentialId,
    ).toBe(primary);
  });

  it('the off switch always works for invalidated legacy connections, evals and use cases', async () => {
    const { api, teamId, primary, run } = await setup();
    await setSetting(`decisions.jev-first-stage.team.${teamId}`, {
      enabled: true,
      credentialId: 999999,
      timeoutMs: 200,
      useCases: {
        'removed.class': { enabled: true, cloudAllowed: false },
        'helena.trading.rules': { enabled: true, cloudAllowed: true },
      },
    });
    const off = await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.data!.enabled).toBe(false);
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary']);
  });

  it('uses a confident, semantically ready result without calling another backend', async () => {
    const { jev, run } = await setup();
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'decided', credentialId: jev });
    expect(outcome.answers.q!.decided).toBe(true);
    expect(calls).toEqual(['jev']);
  });

  for (const mode of ['uncertain', 'specialist'] as const) {
    it(`preserves the same connection's regular class role after ${mode}`, async () => {
      const { api, teamId, jev, run } = await setup();
      expect(
        (
          await api
            .teams({ teamId })
            .decisions.classes({ classId: GENERAL_CLASS })
            .patch({ credentialId: jev })
        ).status,
      ).toBe(200);
      behavior.jev = mode;
      expect(await run()).toMatchObject({ status: 'decided', credentialId: jev });
      expect(attemptCalls).toEqual([
        { model: 'jev', stage: true },
        { model: 'jev', stage: false },
      ]);
    });
  }

  it('preserves the regular fallback even when its connection was already the stage', async () => {
    const { api, teamId, jev, run } = await setup();
    expect(
      (
        await api
          .teams({ teamId })
          .decisions.classes({ classId: GENERAL_CLASS })
          .patch({ fallbackCredentialId: jev })
      ).status,
    ).toBe(200);
    behavior.jev = 'uncertain';
    behavior.primary = 'error';
    expect(await run()).toMatchObject({ status: 'decided', credentialId: jev });
    expect(attemptCalls).toEqual([
      { model: 'jev', stage: true },
      { model: 'primary', stage: false },
      { model: 'jev', stage: false },
    ]);
  });

  for (const mode of ['error', 'network', 'invalid', 'low', 'uncertain', 'specialist'] as const) {
    it(`escalates ${mode} once to the existing backend`, async () => {
      const { primary, run } = await setup();
      behavior.jev = mode;
      expect(await run()).toMatchObject({ status: 'decided', credentialId: primary });
      expect(calls).toEqual(['jev', 'primary']);
    });
  }

  it('a real loopback connection failure resumes the original backend without retry', async () => {
    const { api, teamId, jev, primary, run } = await setup();
    const closed = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({}) });
    const port = closed.port;
    await closed.stop(true);
    expect(
      (
        await api
          .teams({ teamId })
          .credentials({ credentialId: jev })
          .patch({ baseUrl: `http://127.0.0.1:${port}` })
      ).status,
    ).toBe(200);
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary']);
  });

  it('bounds a stalled stage and reserves budget for the existing fallback', async () => {
    const { fallback, run } = await setup({ fallback: true, timeoutMs: 700 });
    behavior.jev = 'wait';
    behavior.primary = 'error';
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = Date.now();
    expect(await run()).toMatchObject({ status: 'decided', credentialId: fallback });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toEqual(['jev', 'primary', 'fallback']);
  });

  it('switching off during an in-flight stage discards it and resumes the original path', async () => {
    const { api, teamId, primary, run } = await setup();
    expect(
      (await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 })).status,
    ).toBe(200);
    behavior.jev = 'wait';
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = run();
    try {
      await waitForStage();
      const stopped = Date.now();
      expect(
        (await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: false })).status,
      ).toBe(200);
      expect(await pending).toMatchObject({ status: 'decided', credentialId: primary });
      expect(Date.now() - stopped).toBeLessThan(500);
      expect(calls).toEqual(['jev', 'primary']);
    } finally {
      release?.();
      await pending;
    }
  });

  for (const revokeCloud of [false, true]) {
    it(`does not dispatch after ${revokeCloud ? 'cloud permission' : 'the master'} is revoked while the gate is pending`, async () => {
      const { api, teamId, jev, primary, run } = await setup();
      let entered = false;
      let resume!: () => void;
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      useDecisionGate(async ({ connection }) => {
        if (connection.credentialId === jev) {
          entered = true;
          await held;
        }
        return null;
      });
      const pending = run();
      try {
        const deadline = Date.now() + 1000;
        while (!entered && Date.now() < deadline) await Bun.sleep(5);
        expect(entered).toBe(true);
        const patch = revokeCloud
          ? { useCases: { [GENERAL_CLASS]: { enabled: false, cloudAllowed: false } } }
          : { enabled: false };
        expect((await api.teams({ teamId }).decisions['first-stage'].patch(patch)).status).toBe(
          200,
        );
        resume();
        expect((await pending).credentialId).toBe(primary);
        expect(calls).toEqual(['primary']);
      } finally {
        resume();
        try {
          await pending;
        } finally {
          useLocalAiForDecisions();
        }
      }
    });
  }

  it('repeated technical errors open the circuit while all workflows keep the original path', async () => {
    const { primary, run } = await setup();
    behavior.jev = 'network';
    for (let i = 0; i < 4; i++) expect((await run()).credentialId).toBe(primary);
    expect(calls.filter((model) => model === 'jev')).toHaveLength(3);
    expect(calls.filter((model) => model === 'primary')).toHaveLength(4);
  });

  it('all backends unavailable returns an undecided outcome, never a backend exception', async () => {
    const { run } = await setup({ fallback: true });
    behavior = { jev: 'error', primary: 'invalid', fallback: 'network' };
    const outcome = await run();
    expect(outcome.status).toBe('error');
    expect(outcome.answers.q!.decided).toBe(false);
    expect(calls).toEqual(['jev', 'primary', 'fallback']);
  });

  it('requires explicit cloud permission, passed evals and a team-wide connection; trading still requires its own eval', async () => {
    const { api, teamId, project, primary, jev, run } = await setup();
    const route = api.teams({ teamId }).decisions['first-stage'];
    expect(
      (await route.patch({ useCases: { [GENERAL_CLASS]: { enabled: true, cloudAllowed: false } } }))
        .status,
    ).toBe(400);
    expect(
      (
        await route.patch({
          useCases: { 'helena.trading.rules': { enabled: true, cloudAllowed: true } },
        })
      ).status,
    ).toBe(409);
    await db.delete(helenaDecisionEval).where(eq(helenaDecisionEval.credentialId, jev));
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary']);
    expect((await route.patch({ enabled: true })).status).toBe(409);
    expect(
      (
        await api
          .teams({ teamId })
          .credentials({ credentialId: jev })
          .patch({ projectId: project.id })
      ).status,
    ).toBe(200);
    expect((await route.patch({ credentialId: jev })).status).toBe(400);
    expect((await run()).credentialId).toBe(primary);
  });

  it('rejects another team project before sending or logging its data', async () => {
    const { api, teamId, run } = await setup();
    const stranger = authedApi((await signUpTestUser()).cookie);
    const foreign = (await stranger.projects.post({ key: 'OTHER', name: 'Other' })).data!;
    expect(
      (await stranger.teams({ teamId }).decisions['first-stage'].patch({ enabled: false })).status,
    ).toBe(404);
    const outcome = await decide({
      teamId,
      projectId: foreign.id,
      classId: GENERAL_CLASS,
      context: 'private synthetic data',
      questions,
    });
    expect(outcome.status).toBe('no_backend');
    expect(calls).toEqual([]);
    expect(await db.select().from(helenaDecision)).toEqual([]);
    expect((await api.teams({ teamId }).decisions.classes.get()).status).toBe(200);
    expect((await run()).status).toBe('decided');
  });
});

async function chatSetup(options: Parameters<typeof setup>[0] = {}) {
  const fixture = await setup(options);
  const { api, teamId, project } = fixture;
  const created = await createAgent(api, 'STAGE', {
    name: 'Stage fixture',
    username: 'stage-fixture',
    kind: 'external',
  });
  expect(created.status).toBe(201);
  const agentId = created.data!.agent.id;
  const sent = await api.projects({ projectKey: 'STAGE' })['ai-agents']({ agentId }).chat.post({
    prompt: 'Yes. Synthetic evidence only.',
  });
  expect(sent.status).toBe(200);
  const chat = api.chats({ threadId: sent.data!.threadId });
  const request = {
    teamId,
    projectId: project.id,
    agentId,
    chatMessageId: sent.data!.messageId,
    classId: GENERAL_CLASS,
    context: 'Yes. Synthetic evidence only.',
    questions,
  };
  return { ...fixture, chat, request, threadId: sent.data!.threadId, run: () => decide(request) };
}

describe('chat-scoped optional Jev first stage', () => {
  it('inherits by default, persists the three modes, and only disables this chat', async () => {
    const { chat, run, primary, jev, teamId, project } = await chatSetup();
    expect((await chat.get()).data!.jevFirstStage).toBe('inherit');
    expect((await run()).credentialId).toBe(jev);
    expect((await chat.patch({ jevFirstStage: 'off' })).status).toBe(204);
    expect((await chat.get()).data!.jevFirstStage).toBe('off');
    expect((await run()).credentialId).toBe(primary);
    expect(
      (
        await decide({
          teamId,
          projectId: project.id,
          classId: GENERAL_CLASS,
          context: 'Yes',
          questions,
        })
      ).credentialId,
    ).toBe(jev);
    for (const mode of ['on', 'inherit'] as const) {
      expect((await chat.patch({ jevFirstStage: mode })).status).toBe(204);
      expect((await chat.get()).data!.jevFirstStage).toBe(mode);
      expect((await run()).credentialId).toBe(jev);
    }
    expect((await firstStagePolicy(teamId)).enabled).toBe(true);
  });

  it('on cannot enable the team, class, cloud use case, or a missing eval', async () => {
    const { api, chat, run, primary, teamId, jev } = await chatSetup({ stage: false });
    expect((await chat.patch({ jevFirstStage: 'on' })).status).toBe(204);
    expect((await run()).credentialId).toBe(primary);
    await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: true });
    await api
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ enabled: false });
    expect((await run()).status).toBe('off');
    await api
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ enabled: true });
    await setSetting(`decisions.jev-first-stage.team.${teamId}`, {
      enabled: true,
      credentialId: jev,
      timeoutMs: 200,
      useCases: { [GENERAL_CLASS]: { enabled: true, cloudAllowed: false } },
    });
    expect((await run()).credentialId).toBe(primary);
    await api.teams({ teamId }).decisions['first-stage'].patch({
      useCases: { [GENERAL_CLASS]: { enabled: true, cloudAllowed: true } },
    });
    await db.delete(helenaDecisionEval).where(eq(helenaDecisionEval.credentialId, jev));
    expect((await run()).credentialId).toBe(primary);
    expect(calls).toEqual(['primary', 'primary', 'primary']);
  });

  it('refuses another member and malformed modes without changing the saved mode', async () => {
    const { api, threadId, chat } = await chatSetup();
    const member = await addProjectMember(api, 'STAGE');
    expect((await member.chats({ threadId }).patch({ jevFirstStage: 'off' })).status).toBe(404);
    // @ts-expect-error Exercise runtime validation of an untrusted request.
    expect((await chat.patch({ jevFirstStage: 'force' })).status).toBe(400);
    expect((await chat.get()).data!.jevFirstStage).toBe('inherit');
  });

  it('requires a matching message, agent, team and project for the chat gate', async () => {
    const { request, chat } = await chatSetup();
    const started = await firstStageChatGuard(request);
    expect(await started()).toBe(true);
    for (const invalid of [
      { chatMessageId: -1 },
      { agentId: null },
      { agentId: -1 },
      { teamId: -1 },
      { projectId: null },
      { projectId: -1 },
    ])
      expect(await (await firstStageChatGuard({ ...request, ...invalid }))()).toBe(false);
    await chat.patch({ jevFirstStage: 'off' });
    await chat.patch({ jevFirstStage: 'on' });
    expect(await started()).toBe(false);
    expect(await (await firstStageChatGuard(request))()).toBe(true);
  });

  for (const reenable of [false, true]) {
    it(`aborts an in-flight stage and continues even after quick off/on: ${reenable}`, async () => {
      const { api, teamId, chat, run, primary } = await chatSetup({ timeoutMs: 3000 });
      await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 });
      behavior.jev = 'wait';
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = run();
      try {
        await waitForStage();
        const stopped = Date.now();
        expect((await chat.patch({ jevFirstStage: 'off' })).status).toBe(204);
        if (reenable) expect((await chat.patch({ jevFirstStage: 'on' })).status).toBe(204);
        expect(await pending).toMatchObject({ status: 'decided', credentialId: primary });
        expect(Date.now() - stopped).toBeLessThan(700);
        expect(calls).toEqual(['jev', 'primary']);
      } finally {
        release?.();
        await pending;
      }
    });
  }

  it('does not dispatch after the chat was switched off while a gate waited', async () => {
    const { chat, jev, primary, run } = await chatSetup();
    let entered = false;
    let resume!: () => void;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    useDecisionGate(async ({ connection }) => {
      if (connection.credentialId === jev) {
        entered = true;
        await held;
      }
      return null;
    });
    const pending = run();
    try {
      const deadline = Date.now() + 1000;
      while (!entered && Date.now() < deadline) await Bun.sleep(5);
      expect(entered).toBe(true);
      await chat.patch({ jevFirstStage: 'off' });
      resume();
      expect((await pending).credentialId).toBe(primary);
      expect(calls).toEqual(['primary']);
    } finally {
      resume();
      await pending;
      useLocalAiForDecisions();
    }
  });

  it('rejects a late successful result after off/on before the next poll', async () => {
    const { chat, primary, run } = await chatSetup();
    behavior.jev = 'wait';
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = run();
    try {
      await waitForStage();
      await chat.patch({ jevFirstStage: 'off' });
      await chat.patch({ jevFirstStage: 'on' });
      release?.();
      expect((await pending).credentialId).toBe(primary);
      expect(calls).toEqual(['jev', 'primary']);
    } finally {
      release?.();
      await pending;
    }
  });
});

it('does not return a partial first-stage result after chat revocation during fallback', async () => {
  const { api, teamId, chat, run, primary } = await chatSetup({ timeoutMs: 3000 });
  await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 });
  behavior.jev = 'low';
  behavior.primary = 'wait-error';
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = run();
  try {
    const deadline = Date.now() + 1000;
    while (!calls.includes('primary') && Date.now() < deadline) await Bun.sleep(5);
    expect(calls).toEqual(['jev', 'primary']);
    await chat.patch({ jevFirstStage: 'off' });
    release?.();
    expect(await pending).toMatchObject({ status: 'error', credentialId: primary });
  } finally {
    release?.();
    await pending;
  }
});

for (const regularMode of ['normal', 'low'] as const) {
  it(`keeps the same independently configured backend after chat off: ${regularMode}`, async () => {
    const { api, teamId, chat, run, jev } = await chatSetup({ timeoutMs: 3000 });
    expect(
      (
        await api
          .teams({ teamId })
          .decisions.classes({ classId: GENERAL_CLASS })
          .patch({ credentialId: jev })
      ).status,
    ).toBe(200);
    await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 });
    behavior['jev:stage'] = 'wait';
    behavior['jev:regular'] = regularMode;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = run();
    try {
      await waitForStage();
      expect((await chat.patch({ jevFirstStage: 'off' })).status).toBe(204);
      expect(await pending).toMatchObject({
        status: regularMode === 'normal' ? 'decided' : 'unsure',
        credentialId: jev,
      });
      expect(attemptCalls).toEqual([
        { model: 'jev', stage: true },
        { model: 'jev', stage: false },
      ]);
    } finally {
      release?.();
      await pending;
    }
  });
}

it('does not grant the revoked stage an unconfigured regular role', async () => {
  const { api, teamId, chat, run, primary } = await chatSetup({ timeoutMs: 3000 });
  await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 });
  behavior['jev:stage'] = 'wait';
  behavior.primary = 'error';
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = run();
  try {
    await waitForStage();
    expect((await chat.patch({ jevFirstStage: 'off' })).status).toBe(204);
    expect(await pending).toMatchObject({ status: 'error', credentialId: primary });
    expect(attemptCalls).toEqual([
      { model: 'jev', stage: true },
      { model: 'primary', stage: false },
    ]);
  } finally {
    release?.();
    await pending;
  }
});

it('keeps unrelated use-case settings and a concurrent master off in the same persisted policy', async () => {
  const { api, teamId } = await setup();
  const policy = api.teams({ teamId }).decisions['first-stage'];
  await Promise.all([
    policy.patch({ enabled: false }),
    policy.patch({ useCases: { [MAIL_CLASS]: { enabled: false, cloudAllowed: false } } }),
  ]);
  const saved = await firstStagePolicy(teamId);
  expect(saved.enabled).toBe(false);
  expect(saved.useCases[GENERAL_CLASS]).toEqual({ enabled: true, cloudAllowed: true });
  expect(saved.useCases[MAIL_CLASS]).toEqual({ enabled: false, cloudAllowed: false });
  expect(await firstStagePolicy(teamId)).toEqual(saved);
});

it('revokes a team stage after a quick master off/on before the next poll', async () => {
  const { api, teamId, primary, run } = await setup({ timeoutMs: 3000 });
  await api.teams({ teamId }).decisions['first-stage'].patch({ timeoutMs: 1000 });
  behavior.jev = 'wait';
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = run();
  try {
    await waitForStage();
    const before = await firstStagePolicy(teamId);
    await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: false });
    await api.teams({ teamId }).decisions['first-stage'].patch({ enabled: true });
    expect((await firstStagePolicy(teamId)).revision).not.toBe(before.revision);
    release?.();
    expect((await pending).credentialId).toBe(primary);
    expect(calls).toEqual(['jev', 'primary']);
  } finally {
    release?.();
    await pending;
  }
});

for (const mode of ['on', 'off', 'uncertain', 'in-flight-off'] as const) {
  it(`applies ${mode} at the actual existing mail classifier`, async () => {
    const { api, teamId, project, primary, jev } = await setup({ timeoutMs: 3000 });
    for (const id of [primary, jev]) await passed(teamId, MAIL_CLASS, id);
    const { accountId, inboxId } = await insertMailAccount(teamId, project.id);
    const config = mailTriageConfig({
      project: 'suggest',
      task: 'off',
      agent: 'off',
      receipts: 'off',
      accountIds: [accountId],
    });
    expect(
      (
        await api
          .teams({ teamId })
          .decisions.classes({ classId: MAIL_CLASS })
          .patch({
            enabled: true,
            credentialId: primary,
            threshold: 0.8,
            timeoutMs: 3000,
            config: { ...config },
          })
      ).status,
    ).toBe(200);
    const policy = api.teams({ teamId }).decisions['first-stage'];
    expect(
      (
        await policy.patch({
          timeoutMs: 1000,
          useCases: { [MAIL_CLASS]: { enabled: mode !== 'off', cloudAllowed: mode !== 'off' } },
        })
      ).status,
    ).toBe(200);
    const message = await insertMessage({
      teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      subject: 'Synthetic triage fixture',
      text: 'Synthetic classification evidence only.',
    });
    if (mode === 'uncertain') behavior.jev = 'uncertain';
    if (mode === 'in-flight-off') {
      behavior.jev = 'wait';
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    const pending = classifyMessage(teamId, config, message.messageRowId, null, project.id);
    try {
      if (mode === 'in-flight-off') {
        await waitForStage();
        await policy.patch({ useCases: { [MAIL_CLASS]: { enabled: false, cloudAllowed: false } } });
      }
      const result = await pending;
      expect(result).not.toBeNull();
      expect(result?.issueId).toBeNull();
      expect(result?.actions.some((action) => action.kind === 'task')).toBe(false);
      expect(calls).toEqual(
        mode === 'on' ? ['jev'] : mode === 'off' ? ['primary'] : ['jev', 'primary'],
      );
    } finally {
      release?.();
      await pending;
    }
  });
}
