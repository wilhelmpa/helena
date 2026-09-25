import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import {
  agentUsage,
  db,
  helenaDecision,
  helenaDecisionEval,
  helenaMailClassification,
  helenaModelRoute,
  mailThread,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { publishChatCatalog } from '#modules/agents/chat/service';
import { setManualPrice } from '#modules/model-prices/service';
import { GENERAL_CLASS, MAIL_CLASS, ROUTER_CLASS } from '../../classes';
import { decide } from '../../service';
import { routeRequest, setAgentRouter } from '#modules/model-router/service';
import { routePrompt } from '#modules/model-router/prompt';
import { classifyMessage } from '#modules/mail-triage/classify';
import { mailTriageConfig } from '#modules/mail-triage/config';
import { projectOptionId } from '../../questions';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import { DECISIONS_LOCAL_AI_CLASS } from '../../local-ai-class';
import { GENERIC_EVAL_CASES } from '../../evals/generic';

// The decisions service (docs/helena-decisions/decisions.md): classes and their settings, the
// eval gate, decide over a System One server and a local logit server, the failsafe and the
// fallback, the log and its corrections, the model router and the mail classifier.

const KEY = 'decision-test-key-0123456789';

// What the stand-in servers answer: per question id the option (or yes probability) to pick;
// the first option otherwise. `delayMs` makes them slow.
let answers: Record<string, string | number> = {};
let delayMs = 0;
const seen: { path: string; body: unknown }[] = [];

function pickFor(id: string, keys: string[]): string {
  const wanted = answers[id];
  return typeof wanted === 'string' && keys.includes(wanted) ? wanted : keys[0]!;
}

let systemOne: Server;
let logit: Server;
let systemOneUrl = '';
let logitUrl = '';

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });
}

beforeAll(async () => {
  systemOne = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${KEY}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ detail: 'invalid key' }));
      return;
    }
    const body = JSON.parse(await readBody(request)) as {
      questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
    };
    seen.push({ path: request.url ?? '', body });
    const out: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(body.questions)) {
      if (question.type === 'noul') {
        const p = typeof answers[id] === 'number' ? (answers[id] as number) : 0.1;
        out[id] = { type: 'noul', noul: p };
      } else {
        const keys = Object.keys(question.criteria ?? {});
        const choice = pickFor(id, keys);
        out[id] = {
          type: 'choice',
          choice,
          probabilities: Object.fromEntries(
            keys.map((key) => [key, key === choice ? 0.94 : 0.06 / (keys.length - 1)]),
          ),
          confidence: 0.9,
        };
      }
    }
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          model: 'laya-test',
          answers: out,
          usage: { input_tokens: 50, output_tokens: 0 },
        }),
      );
    }, delayMs);
  });
  logit = createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request)) as {
      messages: { content: string }[];
      logit_bias: Record<string, number>;
    };
    seen.push({ path: request.url ?? '', body });
    const user = JSON.parse(body.messages[1]!.content) as {
      options: { letter: string; option: string }[];
    };
    // The option whose text starts with the wanted id gets most of the probability.
    const wanted = Object.values(answers).find((value) => typeof value === 'string') as
      string | undefined;
    const top = user.options.map((option) => ({
      token: option.letter,
      prob: wanted && option.option.startsWith(`${wanted}:`) ? 0.9 : 0.1 / user.options.length,
    }));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        model: 'qwen-test',
        choices: [{ logprobs: { content: [{ token: top[0]!.token, top_probs: top }] } }],
        usage: { prompt_tokens: 30, completion_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => systemOne.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => logit.listen(0, '127.0.0.1', resolve));
  systemOneUrl = `http://127.0.0.1:${(systemOne.address() as { port: number }).port}`;
  logitUrl = `http://127.0.0.1:${(logit.address() as { port: number }).port}`;
});

afterAll(() => {
  systemOne?.close();
  logit?.close();
});

beforeEach(async () => {
  await resetDb();
  answers = {};
  delayMs = 0;
  seen.length = 0;
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = (await asOwner.projects.post({ key: 'PRIV', name: 'Privat' })).data!;
  return { owner, asOwner, project, teamId: project.teamId };
}

async function connection(asOwner: Api, teamId: number, overrides: Record<string, unknown> = {}) {
  const res = await asOwner.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Laya (Test)',
    provider: 'compatible',
    baseUrl: systemOneUrl,
    model: 'laya-test',
    allowPrivateAddress: true,
    value: KEY,
    ...overrides,
  } as never);
  expect(res.status).toBe(201);
  return res.data!.id as number;
}

// A passed eval on file, so a class can be switched on without running one.
async function passedEval(teamId: number, classId: string, credentialId: number, threshold = 0.5) {
  await db.insert(helenaDecisionEval).values({
    teamId,
    classId,
    credentialId,
    backendLabel: 'test',
    threshold,
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

async function switchOn(
  asOwner: Api,
  teamId: number,
  classId: string,
  credentialId: number,
  extra: Record<string, unknown> = {},
) {
  await passedEval(teamId, classId, credentialId);
  const res = await asOwner
    .teams({ teamId })
    .decisions.classes({ classId })
    .patch({ credentialId, threshold: 0.6, enabled: true, ...extra } as never);
  expect(res.status).toBe(200);
  return res.data!;
}

describe('decision classes', () => {
  it('lists the classes and switches one on only after a passed eval on its connection', async () => {
    const { asOwner, teamId } = await setup();
    const listed = (await asOwner.teams({ teamId }).decisions.classes.get()).data!;
    expect(listed.classes.map((cls) => cls.id)).toEqual(
      expect.arrayContaining([ROUTER_CLASS, MAIL_CLASS, GENERAL_CLASS, 'helena.receipts']),
    );
    expect(listed.classes.find((cls) => cls.id === GENERAL_CLASS)!.canEnable).toEqual({
      ok: false,
      reason: 'no_connection',
    });
    const credentialId = await connection(asOwner, teamId);
    const refused = await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ credentialId, enabled: true });
    expect(refused.status).toBe(409);
    const view = await switchOn(asOwner, teamId, GENERAL_CLASS, credentialId);
    expect(view.setting).toMatchObject({ enabled: true, credentialId, threshold: 0.6 });
    // A stricter threshold than the eval's is fine; a looser one needs a new eval.
    const looser = await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ threshold: 0.3 });
    expect(looser.data!.setting.enabled).toBe(false);
  });

  it('runs an eval in the background and stores its numbers', async () => {
    const { asOwner, teamId } = await setup();
    const credentialId = await connection(asOwner, teamId);
    const started = await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .evals.post({ credentialId });
    expect(started.status).toBe(202);
    expect(started.data!.status).toBe('running');
    let latest = started.data!;
    for (let i = 0; i < 50 && latest.status === 'running'; i++) {
      await Bun.sleep(100);
      latest = (
        await asOwner.teams({ teamId }).decisions.evals.get({ query: { classId: GENERAL_CLASS } })
      ).data!.evals[0]!;
    }
    expect(latest.status).toBe('done');
    expect(latest.questions).toBeGreaterThan(20);
    expect(latest.inputTokens).toBeGreaterThan(0);
    // The stand-in always picks the first option: not good enough to pass.
    expect(latest.passed).toBe(false);
  });
});

describe('decide', () => {
  it('answers above the threshold, logs every question, and stays off while the class is off', async () => {
    const { asOwner, teamId } = await setup();
    const off = await asOwner.decisions.decide.post({
      question: 'Is this a complaint?',
      context: 'Das Paket kam kaputt an.',
      teamId,
    });
    expect(off.data!.status).toBe('off');
    const credentialId = await connection(asOwner, teamId);
    await switchOn(asOwner, teamId, GENERAL_CLASS, credentialId);
    answers = { q: '1' };
    const res = await asOwner.decisions.decide.post({
      question: 'Which team handles this?',
      options: ['Billing', 'Support', 'Sales'],
      context: 'Ich kann mich nach dem Passwort-Reset nicht mehr einloggen.',
      teamId,
    });
    expect(res.data).toMatchObject({
      status: 'decided',
      choice: '1',
      label: 'Support',
      backend: 'compatible',
    });
    expect(res.data!.probabilities!['1']).toBeCloseTo(0.94, 5);
    const rows = await db.select().from(helenaDecision).where(eq(helenaDecision.teamId, teamId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      classId: GENERAL_CLASS,
      choice: '1',
      status: 'decided',
      inputText: null,
    });
    expect(rows[0]!.inputHash).toHaveLength(64);
    // The owner corrects it; the log shows the correction.
    const corrected = await asOwner
      .teams({ teamId })
      .decisions.log({ decisionId: rows[0]!.id })
      .outcome.post({ outcome: '2' });
    expect(corrected.status).toBe(204);
    const log = (await asOwner.teams({ teamId }).decisions.log.get({ query: {} })).data!;
    expect(log.items[0]).toMatchObject({ outcome: '2', outcomeSource: 'owner' });
    // Below the threshold: answered, but not decided.
    await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ threshold: 0.99 });
    await passedEval(teamId, GENERAL_CLASS, credentialId, 0.99);
    await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ enabled: true });
    const unsure = await asOwner.decisions.decide.post({
      question: 'Which team handles this?',
      options: ['Billing', 'Support'],
      context: 'x',
      teamId,
    });
    expect(unsure.data!.status).toBe('unsure');
  });

  it('keeps the input only where the owner switched it on', async () => {
    const { asOwner, teamId } = await setup();
    const credentialId = await connection(asOwner, teamId);
    await switchOn(asOwner, teamId, GENERAL_CLASS, credentialId, { storeInput: true });
    await asOwner.decisions.decide.post({
      question: 'Is it urgent?',
      context: 'Frist ist morgen.',
      teamId,
    });
    const [row] = await db.select().from(helenaDecision).where(eq(helenaDecision.teamId, teamId));
    expect(row!.inputText).toContain('Frist ist morgen.');
  });

  it('gives up after the failsafe and asks the fallback in the time left', async () => {
    const { asOwner, teamId } = await setup();
    const slow = await connection(asOwner, teamId);
    const fast = await connection(asOwner, teamId, {
      label: 'Lokal',
      provider: 'local-logit',
      baseUrl: logitUrl,
      model: 'qwen',
    });
    await switchOn(asOwner, teamId, GENERAL_CLASS, slow, { timeoutMs: 1500 });
    delayMs = 3000;
    const alone = await decide({
      teamId,
      classId: GENERAL_CLASS,
      context: 'x',
      questions: { q: { kind: 'yesno', question: 'Yes?' } },
    });
    expect(alone.status).toBe('timeout');
    await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ timeoutMs: 3000, fallbackCredentialId: fast });
    delayMs = 5000;
    answers = { q: 'yes' };
    const started = Date.now();
    const rescued = await decide({
      teamId,
      classId: GENERAL_CLASS,
      context: 'x',
      questions: { q: { kind: 'yesno', question: 'Yes?' } },
    });
    expect(Date.now() - started).toBeLessThan(3500);
    // The first connection used up the time limit; there was none left for the second.
    expect(rescued.status).toBe('timeout');
    // A first connection that fails fast (its key is refused) leaves the fallback its time.
    const refused = await connection(asOwner, teamId, { value: 'wrong-key-0123456789' });
    await passedEval(teamId, GENERAL_CLASS, refused);
    await asOwner
      .teams({ teamId })
      .decisions.classes({ classId: GENERAL_CLASS })
      .patch({ credentialId: refused, enabled: true });
    delayMs = 0;
    const fallback = await decide({
      teamId,
      classId: GENERAL_CLASS,
      context: 'x',
      questions: { q: { kind: 'yesno', question: 'Yes?' } },
    });
    expect(fallback.backend).toBe('local-logit');
  }, 20_000);

  it('reads a local logit server: one token, the letters as the distribution', async () => {
    const { asOwner, teamId, project } = await setup();
    const credentialId = await connection(asOwner, teamId, {
      label: 'Lokal',
      provider: 'local-logit',
      baseUrl: logitUrl,
      model: 'qwen',
    });
    await switchOn(asOwner, teamId, GENERAL_CLASS, credentialId);
    const agent = (
      await createAgent(asOwner, 'PRIV', { name: 'Sorter', username: 'sorter', kind: 'external' })
    ).data!;
    answers = { q: 'rechnung' };
    const outcome = await decide({
      teamId,
      classId: GENERAL_CLASS,
      context: 'Ihre Rechnung Nr. 4711',
      questions: {
        q: {
          kind: 'choice',
          question: 'What kind of mail?',
          options: [
            { id: 'newsletter', label: 'A newsletter' },
            { id: 'rechnung', label: 'An invoice' },
          ],
        },
      },
      projectId: project.id,
      agentId: agent.agent.id,
    });
    expect(outcome).toMatchObject({
      status: 'decided',
      backend: 'local-logit',
      model: 'qwen-test',
    });
    expect(outcome.answers.q!.choice).toBe('rechnung');
    const request = seen.find((entry) => entry.path === '/v1/chat/completions')!.body as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({
      max_tokens: 1,
      post_sampling_probs: true,
      chat_template_kwargs: { enable_thinking: false },
    });
    // An agent's decision is in its usage, priced as local.
    const usage = await db.select().from(agentUsage).where(eq(agentUsage.agentId, agent.agent.id));
    expect(usage[0]).toMatchObject({
      kind: 'tool',
      runtime: 'decisions',
      provider: 'local',
      inputTokens: 30,
    });
  });
});

describe('the model router', () => {
  async function routed() {
    const ctx = await setup();
    const credentialId = await connection(ctx.asOwner, ctx.teamId);
    await switchOn(ctx.asOwner, ctx.teamId, ROUTER_CLASS, credentialId);
    const created = (
      await createAgent(ctx.asOwner, 'PRIV', {
        name: 'Coder',
        username: 'coder',
        kind: 'external',
        model: 'claude-opus-test',
      } as never)
    ).data!;
    await publishChatCatalog(created.agent.id, [
      {
        id: 'claude-opus-test',
        name: 'Opus',
        reasoning: false,
        thinkingLevels: [],
        thinkingDefault: null,
        provider: 'anthropic',
      },
      {
        id: 'claude-sonnet-test',
        name: 'Sonnet',
        reasoning: false,
        thinkingLevels: [],
        thinkingDefault: null,
        provider: 'anthropic',
      },
      {
        id: 'claude-haiku-test',
        name: 'Haiku',
        reasoning: false,
        thinkingLevels: [],
        thinkingDefault: null,
        provider: 'anthropic',
      },
    ]);
    for (const [model, price] of [
      ['claude-opus-test', 14],
      ['claude-sonnet-test', 3],
      ['claude-haiku-test', 1],
    ] as const)
      await setManualPrice(
        model,
        { provider: 'anthropic', inputPerMTok: price, outputPerMTok: price * 5 },
        ctx.owner.userId,
      );
    return { ...ctx, agentId: created.agent.id as number };
  }

  it('stays off until the agent is switched on, then moves light self-contained work down', async () => {
    const { teamId, agentId, project } = await routed();
    const request = {
      teamId,
      agentId,
      projectId: project.id,
      configuredModel: 'claude-opus-test',
      thinkingLevel: null,
      text: 'Finde die Datei mit der Login-Route und sag mir den Pfad.',
    };
    expect((await routeRequest(request)).route).toBeNull();
    await setAgentRouter(teamId, agentId, { enabled: true }, null);
    answers = { route: 'light', needs_context: 0.05 };
    const light = await routeRequest(request);
    expect(light).toMatchObject({
      model: 'claude-haiku-test',
      route: { routed: true, reason: 'cheaper_tier', tier: 'light' },
    });
    answers = { route: 'light', needs_context: 0.8 };
    expect((await routeRequest(request)).route).toMatchObject({
      routed: false,
      reason: 'needs_context',
    });
    answers = { route: 'strongest', needs_context: 0.05 };
    expect((await routeRequest(request)).route).toMatchObject({
      routed: false,
      reason: 'same_tier',
      toModel: 'claude-opus-test',
    });
    const rows = await db
      .select()
      .from(helenaModelRoute)
      .where(eq(helenaModelRoute.agentId, agentId));
    expect(rows).toHaveLength(3);
  });

  it("advises the owner's Claude Code: delegate light, self-contained prompts only", async () => {
    const { teamId } = await routed();
    answers = { route: 'light', needs_context: 0.05 };
    const delegate = await routePrompt({
      teamId,
      prompt: 'Finde die Datei mit der Login-Route',
      sessionModel: 'opus',
    });
    expect(delegate).toMatchObject({ decision: 'delegate', model: 'haiku', tier: 'light' });
    expect(delegate.note).toContain('haiku');
    answers = { route: 'strong', needs_context: 0.05 };
    expect(
      (
        await routePrompt({
          teamId,
          prompt: 'Entwirf das Datenmodell der Abrechnung',
          sessionModel: 'opus',
        })
      ).decision,
    ).toBe('handle');
    expect(
      (await routePrompt({ teamId, prompt: '/router status', sessionModel: 'opus' })).decision,
    ).toBe('none');
  });
});

describe('the mail classifier', () => {
  it('classifies new mail, suggests the project and a task, and learns from corrections', async () => {
    const { asOwner, teamId, project, owner } = await setup();
    const credentialId = await connection(asOwner, teamId);
    await switchOn(asOwner, teamId, MAIL_CLASS, credentialId);
    const { accountId, inboxId } = await insertMailAccount(teamId, null);
    const message = await insertMessage({
      teamId,
      accountId,
      folderId: inboxId,
      subject: 'Rechnung 2026-0815',
      text: 'Bitte überweisen Sie 49,95 EUR bis zum 30.09.',
    });
    answers = {
      project: projectOptionId('PRIV'),
      category: 'invoice',
      priority: 'normal',
      needs_reply: 0.1,
      create_task: 0.9,
    };
    const config = mailTriageConfig({ project: 'suggest', task: 'suggest' });
    const view = (await classifyMessage(teamId, config, message.messageRowId, owner.userId))!;
    expect(view).toMatchObject({
      status: 'classified',
      category: 'invoice',
      priority: 'normal',
      needsReply: false,
      createTask: true,
      projectId: project.id,
    });
    const [thread] = await db.select().from(mailThread).where(eq(mailThread.id, view.threadId));
    expect(thread!.suggestedProjectId).toBe(project.id);
    expect(view.actions.map((action) => action.kind)).toEqual(
      expect.arrayContaining(['suggested', 'task']),
    );
    // The owner corrects the kind; the decision of that question gets the outcome.
    const corrected = await asOwner.mail
      .threads({ threadId: view.threadId })
      .classification.patch({ category: 'notification' });
    expect(corrected.data!.category).toBe('notification');
    const decisions = await db
      .select()
      .from(helenaDecision)
      .where(eq(helenaDecision.subject, `mail:${message.messageRowId}`));
    expect(decisions.find((row) => row.questionId === 'category')!.outcome).toBe('notification');
    // The suggested task, accepted.
    await asOwner.mail.threads({ threadId: view.threadId }).patch({ projectId: project.id });
    const accepted = await asOwner.mail
      .threads({ threadId: view.threadId })
      .classification.accept.post({ kind: 'task' });
    expect(accepted.data!.issueId).toBeGreaterThan(0);
    const [stored] = await db
      .select()
      .from(helenaMailClassification)
      .where(eq(helenaMailClassification.threadId, view.threadId));
    expect(stored!.issueId).toBe(accepted.data!.issueId);
  });
});

// A decision connection "Lokale KI auf diesem Server" goes through the local AI's route
// (local-ai-platform.md §6.6): nothing while Lokale KI does not take decisions, then the
// class's model on the registered server with its key, and "Nur lokal" keeps the cloud out.
describe('decisions through the local AI', () => {
  const LOCAL_KEY = 'test-lemonade-key';
  let lemonade: ReturnType<typeof Bun.serve>;
  const asked: { model: string; logprobs: boolean; auth: string | null }[] = [];

  beforeAll(async () => {
    lemonade = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.headers.get('authorization') !== `Bearer ${LOCAL_KEY}`)
          return new Response('no', { status: 401 });
        const path = new URL(request.url).pathname;
        if (path === '/api/v1/health')
          return Response.json({
            status: 'ok',
            version: '2026.39.1',
            all_models_loaded: [
              { model_name: 'Qwen3.6-35B-A3B-GGUF', recipe: 'llamacpp', device: 'gpu' },
            ],
          });
        if (path === '/api/v1/models')
          return Response.json({
            object: 'list',
            data: [
              {
                id: 'Qwen3.6-35B-A3B-GGUF',
                recipe: 'llamacpp',
                labels: ['tool-calling'],
                downloaded: true,
              },
            ],
          });
        if (path !== '/api/v1/chat/completions') return new Response('nf', { status: 404 });
        const body = (await request.json()) as {
          model: string;
          logprobs?: boolean;
          messages: { role: string; content: string }[];
        };
        asked.push({
          model: body.model,
          logprobs: body.logprobs === true,
          auth: request.headers.get('authorization'),
        });
        const user = body.messages.find((message) => message.role === 'user')!.content;
        if (body.logprobs) {
          // The logit readout: the first letter gets most of the probability.
          const options = (JSON.parse(user) as { options: { letter: string }[] }).options;
          const top = options.map((option, index) => ({
            token: option.letter,
            logprob: Math.log(index === 0 ? 0.9 : 0.1 / (options.length - 1)),
          }));
          return Response.json({
            model: body.model,
            choices: [{ logprobs: { content: [{ token: 'A', top_logprobs: top }] } }],
            usage: { prompt_tokens: 40, completion_tokens: 1 },
          });
        }
        // Lokale KI's eval of the class: the right JSON answer for every case.
        const asking = JSON.parse(user) as { text: string };
        const item = GENERIC_EVAL_CASES.find((entry) => entry.context === asking.text)!;
        const expected = [Object.values(item.expected)[0]!].flat()[0];
        return Response.json({
          choices: [
            { message: { role: 'assistant', content: JSON.stringify({ choice: expected }) } },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 8 },
        });
      },
    });
    if (!host.modelServers.get('lemonade')) {
      await host.load(localAiPlugin, {
        id: LOCAL_AI_PLUGIN_ID,
        name: 'Local AI',
        version: '1.0.0',
        sdk: '^0.1.0',
        provides: LOCAL_AI_PROVIDES,
      });
    }
    if (!host.localAiTaskClasses.get(DECISIONS_LOCAL_AI_CLASS.id))
      host.localAiTaskClasses.register(DECISIONS_LOCAL_AI_CLASS);
  });

  afterAll(() => lemonade.stop(true));

  it('asks the model Lokale KI routes decisions to, only while it does', async () => {
    const { asOwner, teamId } = await setup();
    const server = await asOwner.god['local-ai'].servers.post({
      kind: 'lemonade',
      baseUrl: `http://127.0.0.1:${lemonade.port}/api/v1`,
      keySource: 'stored',
      key: LOCAL_KEY,
    });
    expect(server.status).toBe(200);
    const local = await connection(asOwner, teamId, {
      label: 'Lokale KI',
      provider: 'local-logit',
      baseUrl: 'http://127.0.0.1:13305/api/v1',
      model: 'Qwen3.6-35B-A3B-MTP-GGUF',
      keySource: 'local-ai',
      value: undefined,
    });
    await switchOn(asOwner, teamId, GENERAL_CLASS, local);
    const question = {
      teamId,
      classId: GENERAL_CLASS,
      context: 'Das Paket kam kaputt an.',
      questions: {
        q: {
          kind: 'choice' as const,
          question: 'Which team?',
          options: [
            { id: 'support', label: 'Support' },
            { id: 'sales', label: 'Sales' },
          ],
        },
      },
    };
    // Lokale KI off: the connection refuses, nothing is asked.
    const off = await decide(question);
    expect(off.status).toBe('error');
    expect(off.error).toContain('Local AI is switched off');
    expect(asked).toHaveLength(0);

    // Lokale KI evaluates its class, then takes decisions.
    const evaluated = await asOwner.god['local-ai'].evals.post({
      classId: DECISIONS_LOCAL_AI_CLASS.id,
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    expect(evaluated.data).toMatchObject({ passed: true, score: 1 });
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const on = await asOwner.god['local-ai'].policy.patch({
      classes: { [DECISIONS_LOCAL_AI_CLASS.id]: { mode: 'prefer' } },
    });
    expect(on.status).toBe(200);
    asked.length = 0;
    const answered = await decide(question);
    expect(answered).toMatchObject({ status: 'decided', choice: 'support' });
    // The route's model on the registered server, with its key.
    expect(asked).toEqual([
      { model: 'Qwen3.6-35B-A3B-GGUF', logprobs: true, auth: `Bearer ${LOCAL_KEY}` },
    ]);

    // "Nur lokal": a cloud connection is refused before it is asked.
    await asOwner.god['local-ai'].policy.patch({
      classes: { [DECISIONS_LOCAL_AI_CLASS.id]: { mode: 'only' } },
    });
    const cloud = await connection(asOwner, teamId, {
      label: 'Jev',
      provider: 'typesafe',
      baseUrl: 'https://api.typesafe.ai',
      allowPrivateAddress: false,
    });
    await switchOn(asOwner, teamId, GENERAL_CLASS, cloud);
    const refused = await decide(question);
    expect(refused.status).not.toBe('decided');
    expect(refused.error ?? '').toContain('Nur lokal');
  });
});
