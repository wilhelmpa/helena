import { describe, expect, it } from 'bun:test';
import type { RuntimeLocalAi } from '@helena/sdk';
import type { RunnerConfig } from '../config';
import { collectProfile } from '../contributions';
import { modelProvider, runtimeModel } from '../execute';
import {
  cloudFallback,
  hermesLocalAiConfig,
  localKeyVariables,
  localRoute,
  withLocalFallback,
} from '../local-ai';
import type { RuntimePolicySnapshot } from '../policy';
// The contribution registers itself where the Hermes materializer is.
import '../policy';

// Local AI in the runner (docs/helena-decisions/local-ai-platform.md §6): a local model id
// routes to its server's named Hermes provider; the managed configuration names the servers
// and the helper calls only while the snapshot carries local AI, each helper with the main
// model as its fallback.

const LOCAL: RuntimeLocalAi = {
  servers: [
    {
      provider: 'helena-local',
      baseUrl: 'http://127.0.0.1:13305/api/v1',
      keyEnv: 'HELENA_MODEL_SERVER_KEY_LOCAL',
      contextLength: 65536,
      models: [
        { id: 'Qwen3.6-35B-A3B-GGUF', contextLength: 131072, vision: true },
        { id: 'Tiny-GGUF', contextLength: null, vision: false },
      ],
    },
  ],
  helpers: [
    { task: 'compression', provider: 'helena-local', model: 'Qwen3.6-35B-A3B-GGUF' },
    { task: 'vision', provider: 'helena-local', model: 'Qwen3.6-35B-A3B-GGUF' },
  ],
};

function snapshot(localAi: RuntimeLocalAi | null): RuntimePolicySnapshot {
  return {
    revision: 'r1',
    runtimePolicy: { files: [] },
    skills: [],
    localAi,
  };
}

describe('local AI in the runner', () => {
  it('preserves the local provider for native CLI overrides while legacy CLIs receive server model ids', () => {
    const qualified = 'helena-local/Qwen3.6-35B-A3B-GGUF';
    expect(runtimeModel(qualified, 'helena')).toBe(qualified);
    expect(runtimeModel(qualified, 'hermes')).toBe('Qwen3.6-35B-A3B-GGUF');
    expect(runtimeModel('gpt-6-luna', 'helena')).toBe('gpt-6-luna');
  });
  it('uses the host proxy outside isolation and leaves the isolated port for socket routing', () => {
    const halogen: RuntimeLocalAi = {
      servers: [
        {
          provider: 'helena-halogen',
          baseUrl: 'http://127.0.0.1:8731/v1',
          noThinkingBaseUrl: 'http://127.0.0.1:8733/v1',
          keyEnv: null,
          contextLength: 131072,
          models: [{ id: 'flash', contextLength: null, vision: false }],
        },
      ],
      helpers: [],
    };
    const old = process.env.AGENT_ISOLATION;
    try {
      delete process.env.AGENT_ISOLATION;
      const host = hermesLocalAiConfig(halogen) as {
        providers: Record<string, Record<string, unknown>>;
      };
      expect(host.providers['helena-halogen']?.base_url).toBe('http://127.0.0.1:8741/v1');
      expect(host.providers['helena-halogen']?.extra_headers).toEqual({
        'x-volition-halogen-priority': '${VOLITION_HALOGEN_PRIORITY}',
      });
      process.env.AGENT_ISOLATION = 'on';
      const isolated = hermesLocalAiConfig(halogen) as {
        providers: Record<string, Record<string, unknown>>;
      };
      expect(isolated.providers['helena-halogen']?.base_url).toBe('http://127.0.0.1:8731/v1');
    } finally {
      if (old === undefined) delete process.env.AGENT_ISOLATION;
      else process.env.AGENT_ISOLATION = old;
    }
  });
  it('names the model an agent runs on without local AI for its fallback chain', () => {
    const providerOf = (model: string) => (model === 'claude-opus-5' ? 'anthropic' : undefined);
    const defaults = { model: 'gpt-6-luna', provider: 'openai-codex', reasoning: 'low' };
    expect(cloudFallback({ model: 'claude-opus-5', providerOf, defaults })).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
    // Its own model is local (or unset): the runtime's default.
    expect(cloudFallback({ model: 'helena-local/Qwen3.6', providerOf, defaults })).toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
    });
    expect(cloudFallback({ model: null, providerOf, defaults: null })).toBeNull();
    expect(
      cloudFallback({
        model: null,
        providerOf,
        defaults: { ...defaults, provider: null },
        runnerProvider: 'openai-codex',
      }),
    ).toEqual({ provider: 'openai-codex', model: 'gpt-6-luna' });
    // A model no provider is known for is no fallback.
    expect(cloudFallback({ model: 'mystery', providerOf, defaults })).toBeNull();
  });

  it('puts that model first in the chain only while local AI is on', () => {
    const configured = [
      { provider: 'openrouter', model: 'google/gemini-3.6-flash' },
      { provider: 'openai-codex', model: 'gpt-6-luna' },
    ];
    const base = snapshot(LOCAL);
    const on = { ...base, hermes: { fallbackModels: configured } };
    const cloud = { provider: 'openai-codex', model: 'gpt-6-luna' };
    expect(withLocalFallback(on, cloud).hermes?.fallbackModels).toEqual([
      cloud,
      { provider: 'openrouter', model: 'google/gemini-3.6-flash' },
    ]);
    expect(withLocalFallback({ ...on, localAi: null }, cloud)).toEqual({ ...on, localAi: null });
    expect(withLocalFallback(on, null)).toBe(on);
  });
  it('writes each server as a named provider and the helpers with the main model behind them', () => {
    expect(hermesLocalAiConfig(LOCAL)).toEqual({
      providers: {
        'helena-local': {
          base_url: 'http://127.0.0.1:13305/api/v1',
          key_env: 'HELENA_MODEL_SERVER_KEY_LOCAL',
          transport: 'chat_completions',
          context_length: 65536,
          discover_models: false,
          extra_body: { chat_template_kwargs: { enable_thinking: true } },
          stale_timeout_seconds: 240,
          request_timeout_seconds: 900,
          models: {
            'Qwen3.6-35B-A3B-GGUF': { context_length: 131072, supports_vision: true },
            'Tiny-GGUF': {},
          },
        },
      },
      auxiliary: {
        compression: {
          provider: 'helena-local',
          model: 'Qwen3.6-35B-A3B-GGUF',
          fallback_chain: [{ provider: 'main' }],
        },
        vision: {
          provider: 'helena-local',
          model: 'Qwen3.6-35B-A3B-GGUF',
          fallback_chain: [{ provider: 'main' }],
        },
      },
    });
    expect(localKeyVariables(LOCAL)).toEqual(['HELENA_MODEL_SERVER_KEY_LOCAL']);
    // The helpers carry no request fields of their own: Hermes would send them to the
    // fallback (the main model) as well.
    const helpers = (hermesLocalAiConfig(LOCAL) as { auxiliary: Record<string, object> }).auxiliary;
    for (const helper of Object.values(helpers)) expect(helper).not.toHaveProperty('extra_body');
  });

  it('leaves nothing in the profile while local AI is off, and nothing for other runtimes', () => {
    expect(hermesLocalAiConfig(null)).toEqual({});
    const off = collectProfile({ runtime: 'hermes', snapshot: snapshot(null), env: {} });
    expect(off.hermesConfig).not.toHaveProperty('providers');
    expect(off.hermesConfig).not.toHaveProperty(['auxiliary', 'compression']);
    const on = collectProfile({ runtime: 'hermes', snapshot: snapshot(LOCAL), env: {} });
    expect(on.hermesConfig).toHaveProperty(['providers', 'helena-local']);
    // Merged over what other contributions set (learning keeps titles off).
    expect(on.hermesConfig).toMatchObject({
      auxiliary: {
        compression: { provider: 'helena-local', fallback_chain: [{ provider: 'main' }] },
        title_generation: { model_upgrade_enabled: false },
      },
    });
    const claude = collectProfile({ runtime: 'claude', snapshot: snapshot(LOCAL), env: {} });
    expect(claude.hermesConfig).not.toHaveProperty('providers');
  });

  it('sends a local model to its server and anything else as before', () => {
    const config = {
      provider: 'openai-codex',
      models: [{ id: 'claude-sonnet-5', provider: 'anthropic' }],
    } as unknown as RunnerConfig;
    expect(modelProvider(config, 'helena-local/Qwen3.6-35B-A3B-GGUF')).toBe('helena-local');
    expect(runtimeModel('helena-local/Qwen3.6-35B-A3B-GGUF')).toBe('Qwen3.6-35B-A3B-GGUF');
    expect(modelProvider(config, 'claude-sonnet-5')).toBe('anthropic');
    expect(modelProvider(config, 'gpt-5.6-luna')).toBe('openai-codex');
    expect(runtimeModel('gpt-5.6-luna')).toBe('gpt-5.6-luna');
    expect(runtimeModel(null)).toBeNull();
    expect(localRoute('helena-lan/Qwen/Qwen3-8B')).toEqual({
      provider: 'helena-lan',
      model: 'Qwen/Qwen3-8B',
    });
  });

  it('writes a provider without thinking at the other address, and sends `none` there', () => {
    const quiet: RuntimeLocalAi = {
      ...LOCAL,
      servers: [{ ...LOCAL.servers[0]!, noThinkingBaseUrl: 'http://127.0.0.1:13305/v1' }],
    };
    const config = hermesLocalAiConfig(quiet) as {
      providers: Record<string, { base_url: string; extra_body: unknown; key_env: string }>;
    };
    expect(Object.keys(config.providers)).toEqual(['helena-local', 'helena-local--nothink']);
    // Hermes looks a provider's extra_body up by its address: each has its own.
    expect(config.providers['helena-local']).toMatchObject({
      base_url: 'http://127.0.0.1:13305/api/v1',
      extra_body: { chat_template_kwargs: { enable_thinking: true } },
    });
    expect(config.providers['helena-local--nothink']).toMatchObject({
      base_url: 'http://127.0.0.1:13305/v1',
      key_env: 'HELENA_MODEL_SERVER_KEY_LOCAL',
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
    // A server without a second address has one provider: its turns think.
    expect(Object.keys((hermesLocalAiConfig(LOCAL) as { providers: object }).providers)).toEqual([
      'helena-local',
    ]);
    const runner = { provider: 'openai-codex', models: [] } as unknown as RunnerConfig;
    expect(modelProvider(runner, 'helena-local/Qwen3.6-35B-A3B-GGUF', 'none')).toBe(
      'helena-local--nothink',
    );
    expect(modelProvider(runner, 'helena-local/Qwen3.6-35B-A3B-GGUF', 'low')).toBe('helena-local');
    expect(modelProvider(runner, 'gpt-5.6-luna', 'none')).toBe('openai-codex');
    expect(runtimeModel('helena-local/Qwen3.6-35B-A3B-GGUF')).toBe('Qwen3.6-35B-A3B-GGUF');
  });
});
