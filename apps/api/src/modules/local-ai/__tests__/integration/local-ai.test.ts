import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { agentUsage, db } from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { costOfUsage } from '#modules/model-prices/service';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '../../plugin';
import { checkAllServers, localAiStatus } from '../../service';
import { COMPRESSION_CASES } from '../../evals';

// Local AI end to end against a fake Lemonade (docs/helena-decisions/local-ai-platform.md): the
// owner adds the server, a class stays off until its eval passed, the master switch brings the
// local models into the pickers and the runners' profiles, and takes them out again at once.

const KEY = 'test-local-key';
let fake: ReturnType<typeof Bun.serve>;
const requests: { path: string; auth: string | null }[] = [];

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
          return Response.json({ object: 'list', data: MODELS });
        case '/api/v1/chat/completions':
          return Response.json(
            chatAnswer((await request.json()) as Parameters<typeof chatAnswer>[0]),
          );
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
    expect(settings.classes.find((c) => c.id === 'routines')?.blocker).toBe('not-wired');

    // No class leaves "off" before its eval passed.
    const refused = await asOwner.god['local-ai'].policy.patch({
      classes: { 'hermes-helpers': { mode: 'prefer' } },
    });
    expect(refused.status).toBe(409);

    const evaluated = await asOwner.god['local-ai'].evals.post({
      classId: 'hermes-helpers',
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    expect(evaluated.data).toMatchObject({ passed: true, score: 1, cases: 3 });

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
    const failed = await asOwner.god['local-ai'].evals.post({
      classId: 'hermes-helpers',
      modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF',
    });
    answerWrong = false;
    expect(failed.data).toMatchObject({ passed: false });
    const gated = (await asOwner.god['local-ai'].get()).data!;
    expect(gated.classes.find((c) => c.id === 'hermes-helpers')).toMatchObject({
      mode: 'prefer',
      blocker: 'eval-failed',
    });
    expect((await asRunner['agent-runtime'].policy.get()).data!.localAi?.helpers).toEqual([]);
    await asOwner.god['local-ai'].evals.post({
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
