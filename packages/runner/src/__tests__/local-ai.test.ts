import { describe, expect, it } from 'bun:test';
import type { RuntimeLocalAi } from '@helena/sdk';
import type { RunnerConfig } from '../config';
import { collectProfile } from '../contributions';
import { modelProvider, runtimeModel } from '../execute';
import { hermesLocalAiConfig, localKeyVariables, localRoute } from '../local-ai';
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
});
