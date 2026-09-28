import { existsSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { withConfiguredCapabilities, type LocalModel, type ModelServerContext } from '@helena/sdk';
import {
  HALOGEN_DEFAULT_TOKENIZER,
  allowedTokenizerFile,
  halogenCapabilities,
  halogenLoad,
  halogenNoThinkingBaseUrl,
  halogenServer,
  openAiCompatibleServer,
  prometheusValues,
  readVocabulary,
} from '../../server-types';
import { checkOptions, runtimeLocalAi, serverUrl } from '../../service';
import {
  changelogBetween,
  halogenCandidate as halogenCandidateFor,
  localAiUpdateSource,
  newestReleaseTag,
} from '../../integrations';
import { defaultLocalAiPolicy, type ModelServerRow } from '@repo/db';
import { host } from '#shared/helena';

// Halogen as a model server type (docs/helena-decisions/halogen.md): what it reads from
// Halogen's own /health and /metrics, the capabilities the Administrator sets for a server that
// does not say, and the address of the turns without thinking.

// A trimmed copy of Halogen 0.14.2's GET /health on Kingston (2026-09-28).
const HEALTH = {
  status: 'ok',
  model: 'halogen-qwen3.8-flash-next',
  endpoints: ['/v1/chat/completions', '/v1/completions', '/v1/models', '/v1/responses'],
  context: 262144,
  vision: { enabled: false, disabled_because: ['no vision tower'] },
  version: { api: '0.14.2', engine: '0.14.2', match: true },
  chat_template: { probe: 'passed', thinking_control: true },
  engine: { responds: true, probe_s: 1.001 },
  busy: true,
  slots: 2,
  slot_ctx: 262144,
  in_flight: 1,
  queued: 0,
  tool_calls: { wire_format: 'qwen-xml', streaming: true, parallel_tool_calls: true },
  supported: ['reasoning_effort', 'enable_thinking', 'tools', 'tool_choice', 'max_tokens'],
};

const METRICS = [
  '# HELP llamacpp:prompt_tokens_total Number of prompt tokens processed.',
  '# TYPE llamacpp:prompt_tokens_total counter',
  'llamacpp:prompt_tokens_total 144000',
  'llamacpp:prompt_seconds_total 100',
  'llamacpp:tokens_predicted_total 8000',
  'llamacpp:tokens_predicted_seconds_total 200',
  'llamacpp:kv_cache_usage_ratio 0.125',
  'halogen:requests_total 17',
  '',
].join('\n');

const MODELS = {
  object: 'list',
  data: [
    {
      id: 'halogen-qwen3.8-flash-next',
      object: 'model',
      owned_by: 'halogen',
      max_model_len: 262144,
      context_length: 262144,
    },
  ],
};

function fakeContext(
  routes: Record<string, unknown>,
  options: ModelServerContext['options'] = {},
): ModelServerContext & { asked: string[] } {
  const asked: string[] = [];
  const baseUrl = 'http://127.0.0.1:8731/v1';
  return {
    asked,
    baseUrl,
    hasKey: false,
    options,
    async fetch(path) {
      const url = serverUrl(baseUrl, path);
      asked.push(url);
      if (!(url in routes)) return new Response('{"error":"Not Found"}', { status: 404 });
      const body = routes[url];
      return typeof body === 'string'
        ? new Response(body, { status: 200 })
        : Response.json(body as object);
    },
  };
}

const ROUTES = {
  'http://127.0.0.1:8731/health': HEALTH,
  'http://127.0.0.1:8731/metrics': METRICS,
  'http://127.0.0.1:8731/v1/models': MODELS,
};

describe('a server path', () => {
  it('appends to the base, or starts at the root with //', () => {
    expect(serverUrl('http://127.0.0.1:8731/v1', '/models')).toBe(
      'http://127.0.0.1:8731/v1/models',
    );
    expect(serverUrl('http://127.0.0.1:8731/v1/', 'models')).toBe(
      'http://127.0.0.1:8731/v1/models',
    );
    expect(serverUrl('http://127.0.0.1:8731/v1', '//health')).toBe('http://127.0.0.1:8731/health');
  });
});

describe('Halogen', () => {
  it('reads what it can do from its own description', () => {
    expect(halogenCapabilities(HEALTH)).toEqual(['chat', 'tools', 'reasoning']);
    expect(halogenCapabilities({ ...HEALTH, vision: { enabled: true } })).toEqual([
      'chat',
      'tools',
      'reasoning',
      'vision',
    ]);
    expect(halogenCapabilities({})).toEqual(['chat']);
  });

  it('lists its model on the GPU, loaded while it answers', async () => {
    const models = await halogenServer.models(fakeContext(ROUTES));
    expect(models).toEqual([
      {
        id: 'halogen-qwen3.8-flash-next',
        name: 'halogen-qwen3.8-flash-next',
        unit: 'gpu',
        capabilities: ['chat', 'tools', 'reasoning'],
        contextLength: 262144,
        sizeBytes: null,
        downloaded: null,
        loaded: true,
        backend: 'halogen',
        checkpoint: null,
      },
    ]);
  });

  it('reports its version, slots, speed and cache as its status', async () => {
    const context = fakeContext(ROUTES);
    const status = await halogenServer.status(context);
    expect(status.reachable).toBe(true);
    expect(status.version).toBe('0.14.2');
    expect(status.loaded).toEqual([
      { id: 'halogen-qwen3.8-flash-next', unit: 'gpu', backend: 'halogen' },
    ]);
    expect(status.load).toMatchObject({
      outputTokensPerSecond: 40,
      promptTokensPerSecond: 1440,
      slots: 2,
      busySlots: 1,
      queued: 0,
      kvUsagePercent: 12.5,
    });
    // /health and /metrics sit next to /v1, not below it.
    expect(context.asked).toContain('http://127.0.0.1:8731/health');
    expect(context.asked).toContain('http://127.0.0.1:8731/metrics');
  });

  it('is not reachable while its engine is not ok, and says why without a URL', async () => {
    const status = await halogenServer.status(
      fakeContext({ ...ROUTES, 'http://127.0.0.1:8731/health': { status: 'loading' } }),
    );
    expect(status.reachable).toBe(false);
    expect(status.error).toBe('status loading');
    const gone = await halogenServer.status(fakeContext({}));
    expect(gone.reachable).toBe(false);
    expect(gone.error).toBe('HTTP 404');
  });

  it('counts as up while its engine is too busy to describe itself', async () => {
    const context = fakeContext(ROUTES);
    const fetch = context.fetch.bind(context);
    context.fetch = async (path, init) =>
      path === '//health' ? new Promise<Response>(() => undefined) : fetch(path, init);
    const started = Date.now();
    const status = await halogenServer.status(context);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(status.reachable).toBe(true);
    expect(status.version).toBeNull();
    expect(status.loaded).toEqual([
      { id: 'halogen-qwen3.8-flash-next', unit: 'gpu', backend: 'halogen' },
    ]);
    expect(status.load?.outputTokensPerSecond).toBe(40);
    const models = await halogenServer.models(context);
    expect(models[0]!.capabilities).toEqual(['chat', 'tools', 'reasoning']);
    expect(models[0]!.loaded).toBe(true);
  });

  it('keeps its status when /metrics is missing', async () => {
    const { 'http://127.0.0.1:8731/metrics': _metrics, ...rest } = ROUTES;
    const status = await halogenServer.status(fakeContext(rest));
    expect(status.reachable).toBe(true);
    expect(status.load?.outputTokensPerSecond).toBeNull();
    expect(status.load?.slots).toBe(2);
  });

  it('parses Prometheus lines and computes speeds from the counters', () => {
    const values = prometheusValues(METRICS);
    expect(values['llamacpp:prompt_tokens_total']).toBe(144000);
    expect(values['halogen:requests_total']).toBe(17);
    const load = halogenLoad(HEALTH, values, 110_400_000_000, 97);
    expect(load.memoryGb).toBe(110.4);
    expect(load.gpuPercent).toBe(97);
    // A unit whose container runs outside its cgroup reports its own few MB: no figure.
    expect(halogenLoad(HEALTH, values, 40_000_000, null).memoryGb).toBeNull();
    // Nothing answered yet: no speed rather than zero.
    expect(halogenLoad(HEALTH, {}, null, null).outputTokensPerSecond).toBeNull();
  });

  it('has a second address for the turns without thinking on its own port only', () => {
    expect(halogenNoThinkingBaseUrl('http://127.0.0.1:8731/v1')).toBe('http://127.0.0.1:8733/v1');
    expect(halogenNoThinkingBaseUrl('http://10.0.0.5:9000/v1')).toBeNull();
    expect(halogenNoThinkingBaseUrl('not a url')).toBeNull();
  });

  it('has no key by default and lets the Administrator set its capabilities', () => {
    expect(halogenServer.defaultKeySource).toBe('none');
    expect(halogenServer.capabilitiesConfigurable).toBe(true);
    expect(openAiCompatibleServer.capabilitiesConfigurable).toBe(true);
  });

  it('reads a tokenizer only below /var/lib', async () => {
    expect(allowedTokenizerFile('/var/lib/helena-halogen/models/tokenizer/vocab.json')).toBe(
      '/var/lib/helena-halogen/models/tokenizer/vocab.json',
    );
    expect(allowedTokenizerFile('/etc/helena/local-ai.key')).toBeNull();
    expect(allowedTokenizerFile('/var/lib/../etc/passwd.json')).toBeNull();
    expect(allowedTokenizerFile('/var/lib/helena/secret.key')).toBeNull();
    await expect(readVocabulary('/etc/passwd')).rejects.toThrow('below /var/lib');
  });

  // On Kingston, with native/halogen/install.sh's tokenizer in place: the decisions' letters
  // are single tokens of Qwen3.8's vocabulary.
  it.if(existsSync(HALOGEN_DEFAULT_TOKENIZER))(
    'finds the option letters in the installed tokenizer',
    async () => {
      const letters = 'ABCDEFGHIJKLMNOPQRST'.split('');
      const ids = await halogenServer.tokenIds!(fakeContext({}), letters);
      expect(ids.every((id) => typeof id === 'number')).toBe(true);
      expect(new Set(ids).size).toBe(letters.length);
    },
  );
});

describe('capabilities the Administrator sets', () => {
  const chat: LocalModel = {
    id: 'plain-model',
    name: 'plain-model',
    unit: null,
    capabilities: ['chat'],
    contextLength: null,
    sizeBytes: null,
    downloaded: null,
    loaded: false,
    backend: null,
  };

  it('replace what was derived for chat models, and leave other models alone', () => {
    expect(withConfiguredCapabilities(chat, ['vision', 'tools']).capabilities).toEqual([
      'chat',
      'tools',
      'vision',
    ]);
    expect(
      withConfiguredCapabilities({ ...chat, capabilities: ['chat', 'tools'] }, []).capabilities,
    ).toEqual(['chat']);
    expect(withConfiguredCapabilities(chat, null)).toBe(chat);
    const embed = { ...chat, capabilities: ['embeddings' as const] };
    expect(withConfiguredCapabilities(embed, ['tools'])).toBe(embed);
  });

  it('are checked when they are saved', () => {
    expect(checkOptions({ capabilities: ['vision', 'tools'] })).toEqual({
      capabilities: ['tools', 'vision'],
    });
    expect(checkOptions({ capabilities: null })).toEqual({ capabilities: null });
    expect(() => checkOptions({ capabilities: ['embeddings'] })).toThrow('can be set');
    expect(() => checkOptions({ tokenizerFile: '/etc/shadow' })).toThrow('below /var/lib');
    expect(checkOptions(undefined)).toBeUndefined();
  });

  it('reach the runner: a vision model is marked, a reasoning model thinks', () => {
    // The API registers the built-in types at start (plugin helena.local-ai).
    if (!host.modelServers.get(halogenServer.id)) host.modelServers.register(halogenServer);
    const server: ModelServerRow = {
      id: 7,
      slug: 'halogen',
      kind: 'halogen',
      name: 'Halogen',
      baseUrl: 'http://127.0.0.1:8731/v1',
      keySource: 'none',
      keyFile: null,
      enabled: true,
      contextLength: 131072,
      options: {},
      models: [
        withConfiguredCapabilities(
          { ...chat, id: 'halogen-qwen3.8-flash-next', unit: 'gpu', downloaded: null },
          ['tools', 'reasoning', 'vision'],
        ),
      ],
      status: { reachable: true, version: '0.14.2', latencyMs: 3, error: null, loaded: [] },
      checkedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const local = runtimeLocalAi({ ...defaultLocalAiPolicy(), enabled: true }, [server]);
    expect(local?.servers).toEqual([
      {
        provider: 'helena-halogen',
        baseUrl: 'http://127.0.0.1:8731/v1',
        noThinkingBaseUrl: 'http://127.0.0.1:8733/v1',
        keyEnv: null,
        contextLength: 131072,
        models: [{ id: 'halogen-qwen3.8-flash-next', contextLength: null, vision: true }],
      },
    ]);
  });
});

describe('Halogen in the update center', () => {
  it('finds the newest release tag, never latest or a prerelease', () => {
    expect(newestReleaseTag(['0.9.1', 'latest', '0.14.2', '0.14.10', '0.15.0-rc1', '0.2.0'])).toBe(
      '0.14.10',
    );
    expect(newestReleaseTag(['latest'])).toBeNull();
  });

  it('gives the changelog of the versions after the installed one', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 0.15.0',
      'New drafter.',
      '## 0.14.3',
      'Fix A.',
      '## 0.14.2',
      'Fix B.',
      '## 0.14.1',
      'Fix C.',
      '',
    ].join('\n');
    expect(changelogBetween(changelog, '0.14.2', '0.14.3')).toBe('## 0.14.3\nFix A.');
    expect(changelogBetween(changelog, '0.14.1', '0.15.0')).toContain('## 0.14.2\nFix B.');
    expect(changelogBetween(changelog, '0.15.0', '0.15.0')).toBeNull();
  });

  it('reads the tags from ghcr.io with an anonymous token, check only', async () => {
    const asked: { url: string; headers?: Record<string, string> }[] = [];
    const context = {
      now: new Date(),
      log: console,
      manual: true,
      inventory: async () => null,
      fetchText: async () => '',
      async fetchJson<T>(url: string, options?: { headers?: Record<string, string> }) {
        asked.push({ url, headers: options?.headers });
        if (url.startsWith('https://ghcr.io/token')) return { token: 'anon' } as T;
        return { tags: ['0.14.1', '0.14.2', '0.15.0', 'latest'] } as T;
      },
    };
    const servers = [
      {
        id: 3,
        slug: 'halogen',
        kind: 'halogen',
        name: 'Halogen',
        baseUrl: 'http://127.0.0.1:8731/v1',
        keySource: 'none',
        keyFile: null,
        enabled: true,
        contextLength: 131072,
        options: {},
        models: [],
        status: { reachable: true, version: '0.14.2', latencyMs: 3, error: null, loaded: [] },
        checkedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const candidate = await halogenCandidateFor(servers[0]!, context as never);
    expect(candidate).toMatchObject({
      component: 'halogen',
      installed: '0.14.2',
      available: '0.15.0',
      updateAvailable: true,
      applicable: false,
    });
    expect(asked[1]).toEqual({
      url: 'https://ghcr.io/v2/peonist-ai/halogen-flash-server/tags/list',
      headers: { authorization: 'Bearer anon' },
    });
    expect(localAiUpdateSource.hosts).toContain('ghcr.io');
  });
});
