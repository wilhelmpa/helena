import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '../../plugin';
import { runtimeLocalAiNow } from '../../service';

// Halogen and plain OpenAI-compatible servers as the Administrator adds and sets them up
// (docs/helena-decisions/halogen.md §5): no key, what they can do (read from Halogen, set by
// the Administrator for a server that does not say), the load line, and what the runners get.

let halogen: ReturnType<typeof Bun.serve>;
let plain: ReturnType<typeof Bun.serve>;
const authHeaders: (string | null)[] = [];

beforeAll(async () => {
  halogen = Bun.serve({
    port: 0,
    fetch(request) {
      authHeaders.push(request.headers.get('authorization'));
      switch (new URL(request.url).pathname) {
        case '/health':
          return Response.json({
            status: 'ok',
            model: 'halogen-qwen3.8-flash-next',
            version: { api: '0.14.2', engine: '0.14.2' },
            vision: { enabled: false },
            chat_template: { thinking_control: true },
            tool_calls: { wire_format: 'qwen-xml' },
            slots: 2,
            slot_ctx: 262144,
            in_flight: 1,
            queued: 0,
          });
        case '/metrics':
          return new Response(
            'llamacpp:tokens_predicted_total 4000\nllamacpp:tokens_predicted_seconds_total 100\n' +
              'llamacpp:prompt_tokens_total 14400\nllamacpp:prompt_seconds_total 10\n' +
              'llamacpp:kv_cache_usage_ratio 0.25\n',
          );
        case '/v1/models':
          return Response.json({
            object: 'list',
            data: [{ id: 'halogen-qwen3.8-flash-next', context_length: 262144 }],
          });
        default:
          return new Response('not found', { status: 404 });
      }
    },
  });
  plain = Bun.serve({
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === '/v1/models'
        ? Response.json({ data: [{ id: 'my-local-chat' }, { id: 'nomic-embed-text' }] })
        : new Response('not found', { status: 404 });
    },
  });
  if (!host.get(LOCAL_AI_PLUGIN_ID)) {
    await host.load(localAiPlugin, {
      id: LOCAL_AI_PLUGIN_ID,
      name: 'Local AI',
      version: '1.0.0',
      sdk: '^0.1.0',
      provides: LOCAL_AI_PROVIDES,
    });
  }
});

afterAll(() => {
  halogen.stop(true);
  plain.stop(true);
});

beforeEach(resetDb);

async function owner() {
  return authedApi((await signUpTestUser({ name: 'Owner' })).cookie);
}

describe('a Halogen server', () => {
  it('is offered as a kind without a key, whose capabilities the Administrator may set', async () => {
    const api = await owner();
    const types = (await api.god['local-ai'].get()).data!.serverTypes;
    expect(types.find((type) => type.id === 'halogen')).toMatchObject({
      defaultBaseUrl: 'http://127.0.0.1:8731/v1',
      defaultKeySource: 'none',
      capabilitiesConfigurable: true,
    });
    expect(types.find((type) => type.id === 'lemonade')?.capabilitiesConfigurable).toBe(false);
  });

  it('reads its version, model, capabilities and load, and sends no key', async () => {
    const api = await owner();
    const added = await api.god['local-ai'].servers.post({
      slug: 'halogen',
      kind: 'halogen',
      baseUrl: `http://127.0.0.1:${halogen.port}/v1`,
      contextLength: 131072,
    });
    expect(added.status).toBe(200);
    const server = added.data!;
    expect(server).toMatchObject({ key: 'none', keySource: 'none', provider: 'helena-halogen' });
    expect(server.status).toMatchObject({ reachable: true, version: '0.14.2' });
    expect(server.status?.load).toMatchObject({
      outputTokensPerSecond: 40,
      promptTokensPerSecond: 1440,
      slots: 2,
      busySlots: 1,
      queued: 0,
      kvUsagePercent: 25,
    });
    expect(server.models).toMatchObject([
      {
        id: 'halogen-qwen3.8-flash-next',
        modelId: 'helena-halogen/halogen-qwen3.8-flash-next',
        unit: 'gpu',
        capabilities: ['chat', 'tools', 'reasoning'],
        contextLength: 262144,
        loaded: true,
      },
    ]);
    expect(authHeaders.every((header) => header === null)).toBe(true);

    // The card's status names the server with its load.
    const status = (await api.god['local-ai'].status.get()).data!;
    expect(status.servers[0]).toMatchObject({ reachable: true, load: { slots: 2 } });
  });

  it('takes the capabilities the Administrator sets, and goes back to what it says', async () => {
    const api = await owner();
    const created = (
      await api.god['local-ai'].servers.post({
        slug: 'halogen',
        kind: 'halogen',
        baseUrl: `http://127.0.0.1:${halogen.port}/v1`,
      })
    ).data!;
    const set = await api.god['local-ai']
      .servers({ id: created.id })
      .patch({ options: { capabilities: ['tools', 'vision'] } });
    expect(set.status).toBe(200);
    expect(set.data!.options.capabilities).toEqual(['tools', 'vision']);
    expect(set.data!.models[0]!.capabilities).toEqual(['chat', 'tools', 'vision']);

    // The runners get the vision flag while local AI is on.
    await api.god['local-ai'].policy.patch({ enabled: true });
    const local = await runtimeLocalAiNow();
    expect(local?.servers[0]).toMatchObject({
      provider: 'helena-halogen',
      keyEnv: null,
      models: [{ id: 'halogen-qwen3.8-flash-next', vision: true }],
    });
    // Not on Halogen's own port: no second address for turns without thinking.
    expect(local?.servers[0]?.noThinkingBaseUrl).toBeNull();

    const back = await api.god['local-ai']
      .servers({ id: created.id })
      .patch({ options: { capabilities: null } });
    expect(back.data!.options.capabilities).toBeNull();
    expect(back.data!.models[0]!.capabilities).toEqual(['chat', 'tools', 'reasoning']);

    const bad = await api.god['local-ai']
      .servers({ id: created.id })
      .patch({ options: { tokenizerFile: '/etc/helena/local-ai.key' } });
    expect(bad.status).toBe(400);
  });
});

describe('a plain OpenAI-compatible server', () => {
  it('lists chat models without capabilities until the Administrator names them', async () => {
    const api = await owner();
    const created = (
      await api.god['local-ai'].servers.post({
        slug: 'lan',
        kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${plain.port}/v1`,
        keySource: 'none',
      })
    ).data!;
    const chat = () => created.models.find((model) => model.id === 'my-local-chat')!;
    expect(chat().capabilities).toEqual(['chat']);
    expect(created.models.find((model) => model.id === 'nomic-embed-text')!.capabilities).toEqual([
      'embeddings',
    ]);
    const set = (
      await api.god['local-ai']
        .servers({ id: created.id })
        .patch({ options: { capabilities: ['reasoning', 'tools'] } })
    ).data!;
    expect(set.models.find((model) => model.id === 'my-local-chat')!.capabilities).toEqual([
      'chat',
      'tools',
      'reasoning',
    ]);
    // An embedding model keeps what it is.
    expect(set.models.find((model) => model.id === 'nomic-embed-text')!.capabilities).toEqual([
      'embeddings',
    ]);
    // A reasoning model offers thinking levels in the pickers.
    await api.god['local-ai'].policy.patch({ enabled: true });
    const settings = (await api.god['local-ai'].get()).data!;
    expect(settings.servers[0]!.options.capabilities).toEqual(['tools', 'reasoning']);
  });
});
