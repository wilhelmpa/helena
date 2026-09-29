import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, helenaDecisionEval, helenaDecisionClassSetting } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { TRADING_NEWS_CLASS, TRADING_RULES_CLASS, TRADING_ROUTING_CLASS } from '@helena/trading';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { FIRST_STAGE_READINESS, stageCircuitResult } from '#modules/decisions/first-stage';

type Mode = 'normal' | 'uncertain' | 'error' | 'wait';
let mode: Mode = 'normal';
let release: (() => void) | null = null;
let waiting: Promise<void> | null = null;
let server: ReturnType<typeof Bun.serve>;
const calls: { model: string; stage: boolean; state: unknown }[] = [];
const publicInput = {
  kind: 'news' as const,
  publicNews: {
    articleText: 'Fictional DEMO publishes its annual results.',
    instruments: ['DEMO'],
    publicDataConfirmed: true as const,
  },
};

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        model: string;
        state: unknown;
        questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
      };
      const stage = FIRST_STAGE_READINESS in body.questions;
      calls.push({ model: body.model, stage, state: body.state });
      const current = stage ? mode : 'normal';
      if (current === 'wait' && waiting) await waiting; // Intentionally ignores abort.
      if (current === 'error')
        return Response.json({ detail: 'Synthetic provider failure' }, { status: 503 });
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([id, question]) => {
          if (question.type === 'noul') return [id, { type: 'noul', noul: 0.99 }];
          const options = Object.keys(question.criteria ?? {});
          const choice =
            id === FIRST_STAGE_READINESS && current === 'uncertain' ? 'uncertain' : options[0]!;
          return [
            id,
            {
              type: 'choice',
              choice,
              confidence: 0.99,
              probabilities: Object.fromEntries(
                options.map((option) => [
                  option,
                  option === choice ? 0.99 : 0.01 / (options.length - 1),
                ]),
              ),
            },
          ];
        }),
      );
      return Response.json({
        model: body.model,
        answers,
        usage: { input_tokens: 4, output_tokens: 1 },
      });
    },
  });
});
afterAll(() => server.stop(true));
afterEach(() => {
  release?.();
  release = null;
  waiting = null;
});
beforeEach(async () => {
  await resetDb();
  calls.length = 0;
  mode = 'normal';
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
async function connection(api: Api, teamId: number, model: string, provider: string) {
  const result = await api.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: model,
    provider,
    baseUrl: `http://127.0.0.1:${server.port}`,
    allowPrivateAddress: true,
    model,
    value: 'synthetic-trading-stage-key',
  });
  expect(result.status).toBe(201);
  return result.data!.id;
}
async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'TRADE', name: 'Synthetic trading' })).data!;
  const teamId = project.teamId;
  const primary = await connection(api, teamId, 'primary', 'compatible');
  const jev = await connection(api, teamId, 'jev', 'typesafe');
  stageCircuitResult(teamId, jev, true);
  for (const classId of [TRADING_NEWS_CLASS, TRADING_RULES_CLASS, TRADING_ROUTING_CLASS]) {
    await passed(teamId, classId, primary);
    await passed(teamId, classId, jev);
    expect(
      (
        await api
          .teams({ teamId })
          .decisions.classes({ classId })
          .patch({ enabled: true, credentialId: primary, threshold: 0.8, timeoutMs: 2400 })
      ).status,
    ).toBe(200);
  }
  const policy = api.teams({ teamId }).decisions['first-stage'];
  expect(
    (
      await policy.patch({
        credentialId: jev,
        timeoutMs: 1000,
        useCases: { [TRADING_NEWS_CLASS]: { enabled: true, cloudAllowed: true } },
      })
    ).status,
  ).toBe(200);
  expect((await policy.patch({ enabled: true })).status).toBe(200);
  const route = api.projects({ projectKey: 'TRADE' }).trading.classify;
  return { api, project, teamId, primary, jev, policy, run: () => route.post(publicInput), route };
}
const seen = () => calls.map((call) => `${call.model}:${call.stage ? 'stage' : 'regular'}`);
async function waitForStage() {
  const end = Date.now() + 1500;
  while (!calls.some((call) => call.stage) && Date.now() < end) await Bun.sleep(5);
  expect(calls.some((call) => call.stage)).toBe(true);
}
function hold() {
  mode = 'wait';
  waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
}

// Real route -> native decision service -> synthetic loopback transport. No order
// connector, account read, model or external provider is part of this fixture.
describe('trading caller optional Jev stage', () => {
  it('uses declared public data only and keeps configured models unchanged', async () => {
    const { api, teamId, primary, run } = await setup();
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.data!.status).toBe('decided');
    expect(seen()).toEqual(['jev:stage']);
    expect(calls[0]!.state).toMatchObject({
      articleText: publicInput.publicNews.articleText,
      instruments: ['DEMO'],
    });
    expect(Object.keys(calls[0]!.state as object).sort()).toEqual([
      '__helena_judgments',
      'articleText',
      'instruments',
    ]);
    expect(
      (await api.teams({ teamId }).decisions.classes({ classId: TRADING_NEWS_CLASS }).get()).data!
        .setting.credentialId,
    ).toBe(primary);
  });
  for (const off of ['master', 'use-case'] as const)
    it(`${off} off returns to the existing primary`, async () => {
      const { policy, run } = await setup();
      await policy.patch(
        off === 'master'
          ? { enabled: false }
          : { useCases: { [TRADING_NEWS_CLASS]: { enabled: false, cloudAllowed: false } } },
      );
      expect((await run()).data!.model).toBe('primary');
      expect(seen()).toEqual(['primary:regular']);
    });
  for (const fallback of ['uncertain', 'error', 'timeout'] as const)
    it(`${fallback} falls back once with no provider retry`, async () => {
      const { policy, run } = await setup();
      if (fallback === 'timeout') {
        hold();
        await policy.patch({ timeoutMs: 200 });
      } else mode = fallback;
      const response = await run();
      expect(response.data!.model).toBe('primary');
      expect(seen()).toEqual(['jev:stage', 'primary:regular']);
    });
  for (const kind of ['news', 'rule', 'routing'] as const)
    it(`private ${kind} uses the permitted Jev stage and a local fallback`, async () => {
      const { policy, route } = await setup();
      const classId =
        kind === 'news'
          ? TRADING_NEWS_CLASS
          : kind === 'rule'
            ? TRADING_RULES_CLASS
            : TRADING_ROUTING_CLASS;
      await policy.patch({ useCases: { [classId]: { enabled: true, cloudAllowed: true } } });
      mode = 'error';
      const response = await route.post({
        kind,
        context: 'Synthetic private context',
        ...(kind === 'rule' ? { rule: 'Synthetic rule' } : {}),
      });
      expect(response.data!.model).toBe('primary');
      expect(seen()).toEqual(['jev:stage', 'primary:regular']);
    });
  for (const revoke of ['master', 'use-case', 'off-on'] as const)
    it(`${revoke} during an in-flight request discards a late stage response`, async () => {
      const { policy, run } = await setup();
      hold();
      const pending = run();
      try {
        await waitForStage();
        await policy.patch(
          revoke === 'use-case'
            ? { useCases: { [TRADING_NEWS_CLASS]: { enabled: false, cloudAllowed: false } } }
            : { enabled: false },
        );
        if (revoke === 'off-on') await policy.patch({ enabled: true });
        // Leave the transport pending for master/use-case to test the abort race;
        // resolve immediately for off/on to exercise the final revision check.
        if (revoke === 'off-on') release?.();
        const response = await pending;
        expect(response.data!.model).toBe('primary');
        expect(seen()).toEqual(['jev:stage', 'primary:regular']);
        release?.();
      } finally {
        release?.();
        await pending;
      }
    });
  it('preserves an independently configured regular Jev role after optional master off', async () => {
    const { api, teamId, jev, policy, run } = await setup();
    await api
      .teams({ teamId })
      .decisions.classes({ classId: TRADING_NEWS_CLASS })
      .patch({ credentialId: jev });
    await policy.patch({ enabled: false });
    expect((await run()).data!.model).toBe('jev');
    expect(seen()).toEqual(['jev:regular']);
  });
  for (const kind of ['news', 'rule', 'routing'] as const)
    it(`legacy ${kind} cannot send context to cloud primary or cloud fallback`, async () => {
      const { teamId, primary, jev, policy, route } = await setup();
      await policy.patch({ enabled: false });
      const classId =
        kind === 'news'
          ? TRADING_NEWS_CLASS
          : kind === 'rule'
            ? TRADING_RULES_CLASS
            : TRADING_ROUTING_CLASS;
      // Seed a historically inconsistent cloud configuration for local-only classes;
      // the runtime must still refuse it, not rely only on settings validation.
      await db
        .update(helenaDecisionClassSetting)
        .set({ credentialId: jev, fallbackCredentialId: primary })
        .where(
          and(
            eq(helenaDecisionClassSetting.teamId, teamId),
            eq(helenaDecisionClassSetting.classId, classId),
          ),
        );
      const input = {
        kind,
        context: 'Synthetic private balance and position',
        ...(kind === 'rule' ? { rule: 'Synthetic private rule' } : {}),
      };
      expect((await route.post(input)).data!.model).toBe('primary');
      expect(seen()).toEqual(['primary:regular']);
      calls.length = 0;
      await db
        .update(helenaDecisionClassSetting)
        .set({ credentialId: jev, fallbackCredentialId: jev })
        .where(
          and(
            eq(helenaDecisionClassSetting.teamId, teamId),
            eq(helenaDecisionClassSetting.classId, classId),
          ),
        );
      const blocked = await route.post(input);
      expect(blocked.status).toBe(200);
      expect(blocked.data!.status).toBe('no_backend');
      expect(Object.values(blocked.data!.answers).every((answer) => !answer.decided)).toBe(true);
      expect(calls).toEqual([]);
    });
  it('MCP preserves both input modes and rejects forged chat binding without dispatch', async () => {
    const { api, route } = await setup();
    const agent = (
      await createAgent(api, 'TRADE', {
        name: 'Research',
        username: 'research',
        kind: 'external',
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: ['trading_classify'],
          files: [],
        },
      })
    ).data!;
    const call = async (input: Record<string, unknown>) => {
      const response = await app.handle(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${agent.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'trading_classify', arguments: { projectKey: 'TRADE', ...input } },
          }),
        }),
      );
      const text = await response.text();
      return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
    };
    expect((await call(publicInput)).isError).not.toBe(true);
    expect(seen()).toEqual(['jev:stage']);
    calls.length = 0;
    expect(
      (
        await call({
          kind: 'rule',
          context: 'Private synthetic plan',
          rule: 'Private synthetic rule',
        })
      ).isError,
    ).not.toBe(true);
    expect(seen()).toEqual(['primary:regular']);
    calls.length = 0;
    expect((await call({ ...publicInput, chatMessageId: 999999 })).isError).toBe(true);
    expect(calls).toEqual([]);
    expect(
      (await route.post({ ...publicInput, context: 'Private mixed context' } as never)).status,
    ).toBe(400);
    expect(calls).toEqual([]);
  });
});
