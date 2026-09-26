import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { aiAgent, agentRun, agentUsage, db, helenaLocalAiEval, helenaModelServer } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, teamOf } from '#tests/helpers/agents';
import { evaluateLocalAi } from '#tests/helpers/local-ai';
import { costOfUsage } from '#modules/model-prices/service';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '../../plugin';
import {
  checkAllServers,
  forgetServerAnswers,
  localAiStatus,
  runtimeLocalAi,
  settleEvals,
} from '../../service';
import { COMPRESSION_CASES } from '../../evals';

// Local AI end to end against a fake Lemonade (docs/helena-decisions/local-ai-platform.md): the
// owner adds the server, a class stays off until its eval passed, the master switch brings the
// local models into the pickers and the runners' profiles, and takes them out again at once.

const KEY = 'test-local-key';
let fake: ReturnType<typeof Bun.serve>;
const requests: { path: string; auth: string | null }[] = [];
// Set while the fake Lemonade is "stopped": it answers nothing but 503.
let serverDown = false;
// Held while set: each chat answer waits for it (an eval that takes its time).
let answerGate: Promise<void> | null = null;
// The chat-completions bodies the evals sent.
const chatBodies: Record<string, unknown>[] = [];

let extraModels: Record<string, unknown>[] = [];
beforeEach(() => {
  extraModels = [];
});

const MODELS = [
  {
    id: 'Qwen3.6-35B-A3B-GGUF',
    recipe: 'llamacpp',
    labels: ['tool-calling', 'vision'],
    downloaded: true,
    size: 23.3,
    checkpoint: 'unsloth/Qwen3.6-35B-A3B-GGUF:Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf',
  },
  { id: 'Qwen3-Embedding-0.6B-GGUF', recipe: 'llamacpp', labels: ['embeddings'], downloaded: true },
  { id: 'Not-On-Disk-GGUF', recipe: 'llamacpp', labels: [], downloaded: false },
];

// Answers the Hermes-helper eval right: each compression keeps every fact of its case. With
// `answerWrong` (a model after a bad update) it forgets them.
let answerWrong = false;
function chatAnswer(body: { messages: { role: string; content: string }[] }) {
  const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const item = COMPRESSION_CASES.find((entry) => entry.conversation === prompt);
  const content = item && !answerWrong ? item.facts.map((any) => any[0]).join('; ') : 'ok';
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 50, completion_tokens: 12 },
  };
}

beforeAll(async () => {
  fake = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({ path: url.pathname, auth: request.headers.get('authorization') });
      if (serverDown) return new Response('stopped', { status: 503 });
      if (request.headers.get('authorization') !== `Bearer ${KEY}`)
        return new Response('no', { status: 401 });
      switch (url.pathname) {
        case '/api/v1/health':
          return Response.json({
            status: 'ok',
            version: '2026.39.1',
            all_models_loaded: [
              { model_name: 'Qwen3.6-35B-A3B-GGUF', recipe: 'llamacpp', device: 'gpu' },
            ],
          });
        case '/api/v1/system-stats':
          return Response.json({ gpu_percent: 12, npu_percent: 0, vram_gb: 22.4 });
        case '/api/v1/models':
          return Response.json({ object: 'list', data: [...MODELS, ...extraModels] });
        case '/api/v1/chat/completions': {
          if (answerGate) await answerGate;
          const body = (await request.json()) as Parameters<typeof chatAnswer>[0];
          chatBodies.push(body as unknown as Record<string, unknown>);
          return Response.json(chatAnswer(body));
        }
        default:
          return new Response('not found', { status: 404 });
      }
    },
  });
  // The API's own plugin (the app loads it at start; a test app may not).
  if (!host.modelServers.get('lemonade')) {
    await host.load(localAiPlugin, {
      id: LOCAL_AI_PLUGIN_ID,
      name: 'Local AI',
      version: '1.0.0',
      sdk: '^0.1.0',
      provides: LOCAL_AI_PROVIDES,
    });
  }
});

afterAll(() => fake.stop(true));

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'LAI', name: 'Local' });
  const created = (
    await createAgent(asOwner, 'LAI', {
      name: 'Routine',
      username: 'routine',
      kind: 'external',
      triggerOnMention: true,
      model: 'gpt-5.6-luna',
      runtimePolicy: {
        reasoningEffort: 'low',
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
      },
    })
  ).data!;
  const asRunner = apiKeyApi(created.apiKey!);
  await asRunner['agent-chats'].catalog.post({
    models: [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT 5.6 Luna',
        reasoning: true,
        thinkingLevels: ['low'],
        thinkingDefault: 'low',
        provider: 'openai-codex',
      },
    ],
  });
  const added = await asOwner.god['local-ai'].servers.post({
    kind: 'lemonade',
    baseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    keySource: 'stored',
    key: KEY,
  });
  expect(added.status).toBe(200);
  return { asOwner, asRunner, agent: created.agent, server: added.data! };
}

describe('local AI', () => {
  beforeEach(resetDb);

  it('reads the server, gates a class on its eval, and lets the master switch in and out', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    expect(server.status?.reachable).toBe(true);
    expect(server.key).toBe('stored');
    expect(server.models.map((m) => m.modelId)).toContain('helena-local/Qwen3.6-35B-A3B-GGUF');
    // The key went along, and never comes back.
    expect(requests.some((r) => r.auth === `Bearer ${KEY}`)).toBe(true);
    expect(JSON.stringify(server)).not.toContain(KEY);

    const settings = (await asOwner.god['local-ai'].get()).data!;
    const helpers = settings.classes.find((c) => c.id === 'hermes-helpers')!;
    expect(helpers.blocker).toBe('eval-missing');
    expect(helpers.resolvedModel).toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
    expect(settings.classes.find((c) => c.id === 'triage')?.blocker).toBe('not-wired');

    // No class leaves "off" before its eval passed.
    const refused = await asOwner.god['local-ai'].policy.patch({
      classes: { 'hermes-helpers': { mode: 'prefer' } },
    });
    expect(refused.status).toBe(409);

    const evaluated = await evaluateLocalAi(asOwner, {
      classId: 'hermes-helpers',
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    expect(evaluated).toMatchObject({ status: 'done', passed: true, score: 1, cases: 3 });
    expect(evaluated.finishedAt).not.toBeNull();
    // The helper class runs without thinking, and its eval asks the model for exactly that.
    expect(helpers.thinking).toBe('off');
    expect(chatBodies.length).toBeGreaterThan(0);
    for (const body of chatBodies) {
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    }

    // Off: nothing local anywhere.
    const catalogOff = (
      await asOwner
        .projects({ projectKey: 'LAI' })
        ['ai-agents']({ agentId: agent.id })
        .chat.catalog.get()
    ).data!;
    expect(catalogOff.models.some((m) => m.id.startsWith('helena-'))).toBe(false);
    expect((await asRunner['agent-runtime'].policy.get()).data!.localAi).toBeNull();
    expect((await asRunner['agent-runtime']['model-server-keys'].get()).data!.keys).toEqual({});

    // The master switch on, the first time: the default set, as far as its evals passed.
    const on = (await asOwner.god['local-ai'].policy.patch({ enabled: true })).data!;
    expect(on.classes['hermes-helpers']).toEqual({ mode: 'prefer', model: null });
    expect(on.classes.embeddings).toBeUndefined();

    const snapshot = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(snapshot.localAi?.servers).toEqual([
      {
        provider: 'helena-local',
        baseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
        // Lemonade's other path: the provider of the turns without thinking.
        noThinkingBaseUrl: `http://127.0.0.1:${fake.port}/v1`,
        keyEnv: 'HELENA_MODEL_SERVER_KEY_LOCAL',
        contextLength: 65536,
        models: [{ id: 'Qwen3.6-35B-A3B-GGUF', contextLength: null, vision: true }],
      },
    ]);
    expect(snapshot.localAi?.helpers.map((h) => h.task)).toEqual(['compression', 'vision']);
    expect((await asRunner['agent-runtime']['model-server-keys'].get()).data!.keys).toEqual({
      HELENA_MODEL_SERVER_KEY_LOCAL: KEY,
    });
    const catalogOn = (
      await asOwner
        .projects({ projectKey: 'LAI' })
        ['ai-agents']({ agentId: agent.id })
        .chat.catalog.get()
    ).data!;
    const local = catalogOn.models.find((m) => m.id === 'helena-local/Qwen3.6-35B-A3B-GGUF');
    expect(local).toMatchObject({ local: true, provider: 'helena-local' });
    // A model the server has not downloaded is not offered.
    expect(catalogOn.models.some((m) => m.id.endsWith('Not-On-Disk-GGUF'))).toBe(false);

    // The model changes (an update) and fails its eval again: the class stays switched on, but
    // Hermes' helpers go back to the agent's own model until a new eval passes.
    answerWrong = true;
    const failed = await evaluateLocalAi(asOwner, {
      classId: 'hermes-helpers',
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    answerWrong = false;
    expect(failed).toMatchObject({ passed: false });
    const gated = (await asOwner.god['local-ai'].get()).data!;
    expect(gated.classes.find((c) => c.id === 'hermes-helpers')).toMatchObject({
      mode: 'prefer',
      blocker: 'eval-failed',
    });
    expect((await asRunner['agent-runtime'].policy.get()).data!.localAi?.helpers).toEqual([]);
    await evaluateLocalAi(asOwner, {
      classId: 'hermes-helpers',
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    expect(
      (await asRunner['agent-runtime'].policy.get()).data!.localAi?.helpers.map((h) => h.task),
    ).toEqual(['compression', 'vision']);

    // Off again: the next snapshot has none of it (the runner rewrites every profile).
    await asOwner.god['local-ai'].policy.patch({ enabled: false });
    const after = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(after.localAi).toBeNull();
    expect(after.revision).not.toBe(snapshot.revision);
  });

  it('removes a disabled device from the picker and runtime, and falls back for an already queued explicit chat', async () => {
    extraModels = [
      { id: 'Qwen-fixture-FLM', recipe: 'flm', labels: ['tool-calling'], downloaded: true },
    ];
    const { asOwner, asRunner, agent } = await setup();
    const local = 'helena-local/Qwen-fixture-FLM';
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const chat = asOwner.projects({ projectKey: 'LAI' })['ai-agents']({ agentId: agent.id });
    expect((await chat.chat.catalog.get()).data?.models.map((item) => item.id)).toContain(local);
    const before = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(before.localAi?.servers[0]?.models.map((item) => item.id)).toContain('Qwen-fixture-FLM');
    expect((await chat.chat.post({ prompt: 'synthetic fixture', model: local })).status).toBe(200);
    const switched = await asOwner.god['local-ai'].policy.patch({ units: { npu: false } });
    expect(switched.status).toBe(200);
    const policyBeforeClaim = (await asOwner.god['local-ai'].get()).data!.policy;
    expect((await chat.chat.catalog.get()).data?.models.map((item) => item.id)).not.toContain(
      local,
    );
    const after = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(after.revision).not.toBe(before.revision);
    expect(after.localAi?.servers[0]?.models.map((item) => item.id)).toEqual([
      'Qwen3.6-35B-A3B-GGUF',
    ]);
    const beforeRequests = requests.length;
    const claimed = (await asRunner['agent-chats'].claim.post()).data!.message!;
    expect(claimed.model).toBe('gpt-5.6-luna');
    expect(requests.length).toBe(beforeRequests);
    expect(
      (await db.select({ model: aiAgent.model }).from(aiAgent).where(eq(aiAgent.id, agent.id)))[0]
        ?.model,
    ).toBe('gpt-5.6-luna');
    expect((await asOwner.god['local-ai'].get()).data!.policy).toEqual(policyBeforeClaim);
  });

  it('keeps an explicit agent assignment but uses the runtime default when its device is disabled', async () => {
    extraModels = [{ id: 'Qwen-fixture-FLM', recipe: 'flm', labels: [], downloaded: true }];
    const { asOwner, asRunner, agent } = await setup();
    const local = 'helena-local/Qwen-fixture-FLM';
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const view = (await asOwner.projects({ projectKey: 'LAI' }).get()).data!;
    expect(
      (
        await asOwner
          .teams({ teamId: view.project.teamId })
          ['ai-agents']({ agentId: agent.id })
          .patch({ model: local })
      ).status,
    ).toBe(200);
    await asOwner.god['local-ai'].policy.patch({ units: { npu: false } });
    const issue = (
      await asOwner
        .projects({ projectKey: 'LAI' })
        .issues.post({ columnId: view.columns[0]!.id, title: 'Synthetic device check' })
    ).data!;
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please @routine' });
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(claimed.model).toBeNull();
    expect(claimed.thinkingLevel).toBeNull();
    const [saved] = await db
      .select({ model: aiAgent.model })
      .from(aiAgent)
      .where(eq(aiAgent.id, agent.id));
    expect(saved?.model).toBe(local);
  });

  it('does not select a vision helper on a disabled device alongside an allowed compression model', async () => {
    const { asOwner, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const [row] = await db
      .select()
      .from(helenaModelServer)
      .where(eq(helenaModelServer.id, server.id));
    const gpu = { ...row!.models[0]!, capabilities: ['chat' as const] };
    const npu = {
      ...gpu,
      id: 'NPU-vision-fixture',
      unit: 'npu' as const,
      capabilities: ['chat' as const, 'vision' as const],
      loaded: true,
    };
    const policy = (await asOwner.god['local-ai'].get()).data!.policy;
    policy.units.npu = false;
    policy.classes['hermes-helpers'] = {
      mode: 'prefer',
      model: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    };
    const runtime = runtimeLocalAi(policy, [{ ...row!, models: [npu, gpu] }]);
    expect(runtime?.helpers).toEqual([
      { task: 'compression', provider: 'helena-local', model: 'Qwen3.6-35B-A3B-GGUF' },
    ]);
    expect(runtime?.servers[0]?.models.map((model) => model.id)).toEqual(['Qwen3.6-35B-A3B-GGUF']);
  });

  it('runs an agent set to a local model on its default while local AI is off', async () => {
    const { asOwner, asRunner, agent } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const view = (await asOwner.projects({ projectKey: 'LAI' }).get()).data!;
    const edited = await asOwner
      .teams({ teamId: view.project.teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ model: 'helena-local/Qwen3.6-35B-A3B-GGUF' });
    expect(edited.status).toBe(200);
    const run = async () => {
      const issue = (
        await asOwner
          .projects({ projectKey: 'LAI' })
          .issues.post({ columnId: view.columns[0]!.id, title: 'Digest' })
      ).data!;
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please @routine' });
      return (await asRunner['agent-runs'].claim.post()).data!.run!;
    };
    expect((await run()).model).toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
    await asOwner.god['local-ai'].policy.patch({ enabled: false });
    const fallback = await run();
    expect(fallback.model).toBeNull();
    expect(fallback.thinkingLevel).toBeNull();
  });

  it('answers with the configured model when the local server does not, and says so', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const chat = asOwner.projects({ projectKey: 'LAI' })['ai-agents']({ agentId: agent.id });
    serverDown = true;
    try {
      // The server stopped since its last check: the claim asks it once and gets no answer.
      forgetServerAnswers();
      await db
        .update(helenaModelServer)
        .set({ checkedAt: new Date(Date.now() - 60_000) })
        .where(eq(helenaModelServer.id, server.id));
      const sent = await chat.chat.post({
        prompt: 'Hallo',
        model: 'helena-local/Qwen3.6-35B-A3B-GGUF',
      });
      expect(sent.status).toBe(200);
      const claimed = (await asRunner['agent-chats'].claim.post()).data!.message!;
      // The agent's own model, with its own reasoning, instead of waiting for the server.
      expect(claimed.model).toBe('gpt-5.6-luna');
      await asRunner['agent-chats']({ messageId: claimed.id }).events.post({
        events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Hallo zurück' }],
      });
      await asRunner['agent-chats']({ messageId: claimed.id }).result.post({
        status: 'success',
        runtime: {
          requested: { model: 'gpt-5.6-luna', reasoning: 'low', provider: 'openai-codex' },
          defaults: null,
          used: { model: 'gpt-5.6-luna', reasoning: 'low', provider: 'openai-codex' },
        },
      });
      const threadId = sent.data!.threadId;
      const items = (await chat.threads({ threadId }).messages.get()).data!.items;
      expect(items.find((item) => item.role === 'assistant')?.localFallback).toEqual({
        from: 'helena-local/Qwen3.6-35B-A3B-GGUF',
        reason: 'down',
      });
    } finally {
      serverDown = false;
      forgetServerAnswers();
    }
  });

  it('runs an eval in the background and answers at once, one per class and model', async () => {
    const { asOwner } = await setup();
    let release!: () => void;
    answerGate = new Promise((resolve) => (release = resolve));
    try {
      const body = { classId: 'hermes-helpers', modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF' };
      const started = await asOwner.god['local-ai'].evals.post(body);
      expect(started.status).toBe(202);
      expect(started.data).toMatchObject({ status: 'running', score: 0, finishedAt: null });
      const id = started.data!.id;
      expect((await asOwner.god['local-ai'].evals({ id }).get()).data?.status).toBe('running');
      const settings = (await asOwner.god['local-ai'].get()).data!;
      expect(settings.runningEvals.map((e) => e.id)).toEqual([id]);
      // A running eval gates nothing: the class still needs its eval.
      expect(settings.evals).toEqual([]);
      expect(settings.classes.find((c) => c.id === 'hermes-helpers')?.blocker).toBe('eval-missing');
      expect((await asOwner.god['local-ai'].evals.post(body)).status).toBe(409);
      release();
      await settleEvals();
      expect((await asOwner.god['local-ai'].evals({ id }).get()).data).toMatchObject({
        status: 'done',
        passed: true,
        score: 1,
      });
      const after = (await asOwner.god['local-ai'].get()).data!;
      expect(after.runningEvals).toEqual([]);
      expect(after.evals.map((e) => e.id)).toEqual([id]);
      expect((await asOwner.god['local-ai'].evals({ id: 999_999 }).get()).status).toBe(404);
    } finally {
      answerGate = null;
      release?.();
    }
  });

  it('prices local tokens at nothing, and reports the machine', async () => {
    const { asOwner } = await setup();
    const cost = await costOfUsage('helena-local/Qwen3.6-35B-A3B-GGUF', 'helena-local', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(0);
    expect(
      await costOfUsage('Qwen3.6-35B-A3B-GGUF', 'custom:helena-local', {
        inputTokens: 5,
        outputTokens: 5,
      }),
    ).toBe(0);
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await checkAllServers();
    const status = await localAiStatus();
    expect(status.enabled).toBe(true);
    expect(status.servers[0]).toMatchObject({ reachable: true, version: '2026.39.1' });
    expect(status.units.gpu.loaded.map((m) => m.modelId)).toEqual([
      'helena-local/Qwen3.6-35B-A3B-GGUF',
    ]);
    expect(status.usage).toEqual({ days: 7, localTokens: 0, cloudTokens: 0 });
    expect(await db.select().from(agentUsage)).toEqual([]);
    const route = await asOwner.god['local-ai'].status.get();
    expect(route.status).toBe(200);
  });

  it('refuses a key file outside /etc/helena and a second server of the same name', async () => {
    const { asOwner } = await setup();
    const outside = await asOwner.god['local-ai'].servers.post({
      slug: 'other',
      keySource: 'file',
      keyFile: '/etc/volition/plan.env',
    });
    expect(outside.status).toBe(400);
    const twice = await asOwner.god['local-ai'].servers.post({ slug: 'local', keySource: 'none' });
    expect(twice.status).toBe(409);
  });
});

// Kinds of work Helena hands to local AI as an agent's turn (local-ai-platform.md §7.1): a run
// that names its kind (agent_run.work_class) starts on the class's local model while the class
// runs locally and its server answers, and on its own model otherwise, with the reason shown.
describe('local AI takes kinds of work', () => {
  beforeEach(resetDb);

  const LOCAL = 'helena-local/Qwen3.6-35B-A3B-GGUF';

  // An eval of the class's model that passed, as "Auswerten" stores it.
  async function passed(serverId: number, classId: string, evalVersion: number) {
    await db.insert(helenaLocalAiEval).values({
      classId,
      serverId,
      model: 'Qwen3.6-35B-A3B-GGUF',
      score: 1,
      threshold: 0.8,
      passed: true,
      cases: 4,
      evalVersion,
    });
  }

  async function queueWork(
    agentId: number,
    workClass: string | null,
    values: Partial<typeof agentRun.$inferInsert> = {},
  ) {
    const [project] = await db.execute<{ id: number }>(
      sql`SELECT id FROM project WHERE key = 'LAI'`,
    );
    const [row] = await db
      .insert(agentRun)
      .values({
        agentId,
        projectId: project!.id,
        issueId: null,
        prompt: 'Fasse die Versionshinweise zusammen.',
        trigger: 'digest',
        model: 'gpt-5.6-luna',
        reasoning: 'low',
        workClass,
        ...values,
      })
      .returning({ id: agentRun.id });
    return row!.id;
  }

  async function checkOf(runId: number) {
    const [row] = await db
      .select({ modelCheck: agentRun.modelCheck })
      .from(agentRun)
      .where(eq(agentRun.id, runId));
    return row?.modelCheck as Record<string, unknown> | null;
  }

  it('offers these kinds of work off and prefer only, and gates them on the eval of their version', async () => {
    const { asOwner, server } = await setup();
    const settings = (await asOwner.god['local-ai'].get()).data!;
    for (const id of ['summaries', 'routines', 'reflection', 'coordinator-triage']) {
      const entry = settings.classes.find((c) => c.id === id)!;
      expect(entry).toMatchObject({
        wired: true,
        modes: ['off', 'prefer'],
        // The reflection's eval changed once more: it runs without thinking.
        evalVersion: id === 'reflection' ? 3 : 2,
      });
    }
    expect(settings.classes.find((c) => c.id === 'embeddings')?.modes).toEqual([
      'off',
      'prefer',
      'only',
    ]);
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    // A pass of the eval's older version does not count: it measured something else.
    await passed(server.id, 'summaries', 1);
    const stale = await asOwner.god['local-ai'].policy.patch({
      classes: { summaries: { mode: 'prefer' } },
    });
    expect(stale.status).toBe(409);
    expect(
      (await asOwner.god['local-ai'].get()).data!.classes.find((c) => c.id === 'summaries')
        ?.blocker,
    ).toBe('eval-missing');
    await passed(server.id, 'summaries', 2);
    const only = await asOwner.god['local-ai'].policy.patch({
      classes: { summaries: { mode: 'only' } },
    });
    expect(only.status).toBe(400);
    const on = await asOwner.god['local-ai'].policy.patch({
      classes: { summaries: { mode: 'prefer' } },
    });
    expect(on.status).toBe(200);
  });

  it('starts a digest on the local model while summaries run locally, on its own model otherwise', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await passed(server.id, 'summaries', 2);
    await asOwner.god['local-ai'].policy.patch({ classes: { summaries: { mode: 'prefer' } } });

    const localRun = await queueWork(agent.id, 'summaries');
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(claimed).toMatchObject({ id: localRun, model: LOCAL, thinkingLevel: null });
    expect(await checkOf(localRun)).toMatchObject({
      configured: { model: LOCAL, source: 'local', workClass: 'summaries' },
    });
    await asRunner['agent-runs']({ runId: localRun }).result.post({
      status: 'success',
      output: '{"zusammenfassung": "ok"}',
      runtime: {
        requested: { model: LOCAL, reasoning: null, provider: 'helena-local' },
        defaults: null,
        used: { model: 'Qwen3.6-35B-A3B-GGUF', reasoning: null, provider: 'helena-local' },
      },
    });
    // What really ran is the local model: no mismatch, and it says why it ran there.
    expect(await checkOf(localRun)).toMatchObject({
      configured: { model: LOCAL, source: 'local', workClass: 'summaries' },
      used: { model: 'Qwen3.6-35B-A3B-GGUF' },
      mismatch: [],
    });

    // Work of another kind, or of none, keeps its model.
    const other = await queueWork(agent.id, null);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: other,
      model: 'gpt-5.6-luna',
      thinkingLevel: 'low',
    });
    await asRunner['agent-runs']({ runId: other }).result.post({ status: 'success' });

    // The server stops: the digest runs on the model chosen for it, and says why.
    serverDown = true;
    try {
      forgetServerAnswers();
      await db
        .update(helenaModelServer)
        .set({ checkedAt: new Date(Date.now() - 60_000) })
        .where(eq(helenaModelServer.id, server.id));
      const down = await queueWork(agent.id, 'summaries');
      expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
        id: down,
        model: 'gpt-5.6-luna',
        thinkingLevel: 'low',
      });
      expect(await checkOf(down)).toMatchObject({
        configured: { model: 'gpt-5.6-luna', source: 'run', workClass: 'summaries' },
        fallback: { from: LOCAL, reason: 'down' },
      });
      await asRunner['agent-runs']({ runId: down }).result.post({ status: 'success' });
    } finally {
      serverDown = false;
      forgetServerAnswers();
    }

    // The master switch off: as without local AI, with nothing to explain.
    await asOwner.god['local-ai'].policy.patch({ enabled: false });
    const off = await queueWork(agent.id, 'summaries');
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: off,
      model: 'gpt-5.6-luna',
    });
    expect(await checkOf(off)).toBeNull();
  });

  it('resumes a run on the model its session began with', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await passed(server.id, 'summaries', 2);
    const summaries = (mode: 'off' | 'prefer') =>
      asOwner.god['local-ai'].policy.patch({ classes: { summaries: { mode } } });
    // The runner that held it stopped, its lease ran out: the next claim resumes the session.
    const interrupt = async (id: number, claim: number, sessionId: string) => {
      await asRunner['agent-runs']({ runId: id }).session.post({ sessionId }, { query: { claim } });
      await db
        .update(agentRun)
        .set({ nextAttemptAt: sql`now() - interval '1 second'` })
        .where(eq(agentRun.id, id));
    };

    await summaries('prefer');
    const local = await queueWork(agent.id, 'summaries');
    const first = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(first).toMatchObject({ id: local, model: LOCAL });
    await interrupt(local, first.claim, 'sess-local');
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: local,
      sessionId: 'sess-local',
      model: LOCAL,
    });
    await asRunner['agent-runs']({ runId: local }).result.post({ status: 'success' });

    await summaries('off');
    const cloud = await queueWork(agent.id, 'summaries');
    const began = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(began).toMatchObject({ id: cloud, model: 'gpt-5.6-luna' });
    await interrupt(cloud, began.claim, 'sess-cloud');
    // Switched on meanwhile: the session that began on the cloud model is not moved.
    await summaries('prefer');
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: cloud,
      sessionId: 'sess-cloud',
      model: 'gpt-5.6-luna',
    });
  });

  it('keeps a run on its model while its eval failed, and a routine run follows its own class', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await passed(server.id, 'routines', 2);
    await asOwner.god['local-ai'].policy.patch({ classes: { routines: { mode: 'prefer' } } });
    const routine = await queueWork(agent.id, 'routines', { trigger: 'delegation', model: null });
    // A run without a model of its own runs on the agent's; now on the local one.
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: routine,
      model: LOCAL,
    });
    await asRunner['agent-runs']({ runId: routine }).result.post({ status: 'success' });
    // Summaries are off: a digest keeps its model.
    const digest = await queueWork(agent.id, 'summaries');
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: digest,
      model: 'gpt-5.6-luna',
    });
    await asRunner['agent-runs']({ runId: digest }).result.post({ status: 'success' });
    // The model is updated and fails the routines eval: routines run on the agent's model.
    await db.insert(helenaLocalAiEval).values({
      classId: 'routines',
      serverId: server.id,
      model: 'Qwen3.6-35B-A3B-GGUF',
      score: 0.5,
      threshold: 0.9,
      passed: false,
      cases: 8,
      evalVersion: 2,
    });
    const after = await queueWork(agent.id, 'routines', { trigger: 'delegation', model: null });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: after,
      model: 'gpt-5.6-luna',
      thinkingLevel: 'low',
    });
  });

  it('reflects on the local model after a small session, on the run model after a large one', async () => {
    const { asOwner, asRunner, agent, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    // Version 2 thought, and failed live (every case ran out of tokens): it no longer counts.
    await passed(server.id, 'reflection', 2);
    expect(
      (await asOwner.god['local-ai'].policy.patch({ classes: { reflection: { mode: 'prefer' } } }))
        .status,
    ).toBe(409);
    await passed(server.id, 'reflection', 3);
    await asOwner.god['local-ai'].policy.patch({ classes: { reflection: { mode: 'prefer' } } });
    // A failed run after a tool call asks for a reflection; `read` is what it read in all.
    const finish = async (read: number | null) => {
      const id = await queueWork(agent.id, null, { trigger: 'manual', model: null });
      expect((await asRunner['agent-runs'].claim.post()).data!.run!.id).toBe(id);
      const res = await asRunner['agent-runs']({ runId: id }).result.post({
        status: 'failed',
        error: 'The page did not load',
        sessionId: `sess-${id}`,
        toolCalls: 2,
        ...(read !== null && { usage: { inputTokens: read, outputTokens: 400 } }),
      });
      return { id, reflection: res.data!.reflection };
    };
    const small = await finish(41_000);
    // Without thinking, as its eval ran: on the server's provider without thinking.
    expect(small.reflection).toEqual({
      prompt: expect.any(String),
      maxTurns: 8,
      runBudgetSeconds: 240,
      model: LOCAL,
      thinkingLevel: 'none',
    });
    const teamId = await teamOf(asOwner, 'LAI');
    const view = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .runs.get({ query: {} });
    expect(view.data!.items.find((item) => item.id === small.id)?.reflection).toMatchObject({
      status: 'pending',
      model: LOCAL,
    });
    // Too large to load quickly, or of unknown size: the run's own model, as before.
    expect((await finish(90_000)).reflection).toEqual({
      prompt: expect.any(String),
      maxTurns: 8,
      runBudgetSeconds: 120,
    });
    expect((await finish(null)).reflection).toEqual({
      prompt: expect.any(String),
      maxTurns: 8,
      runBudgetSeconds: 120,
    });
  });
});
