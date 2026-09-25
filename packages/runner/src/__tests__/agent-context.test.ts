import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeLocalAi } from '@helena/sdk';
import { collectProfile } from '../contributions';
import { hermesCompressionConfig } from '../hermes-settings';
import {
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
  type RuntimeStatus,
} from '../policy';
import { fakeHermes } from './hermes-fake';

// docs/helena-decisions/agent-context.md: Hermes' compression written from Helena (§6), the
// skills that ship with Hermes seeded the same way into every profile (§3).

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function snapshot(
  revision: string,
  hermes: RuntimePolicySnapshot['hermes'] = {},
): RuntimePolicySnapshot {
  return { revision, runtimePolicy: { files: [] }, skills: [], hermes };
}

async function managed(hermesHome: string) {
  return JSON.parse(await readFile(join(hermesHome, 'run/itsaplan-managed/config.yaml'), 'utf8'));
}

// A fake reader that records the seedings asked for.
function seedingHermes(fail = false) {
  const hermes = fakeHermes();
  const seeded: { home: string; mode: string }[] = [];
  hermes.seedSkills = async (home, mode) => {
    seeded.push({ home, mode });
    if (fail) throw new Error("Hermes' Python failed with 1");
    return { copied: 3, updated: 0, userModified: 0, total: 60 };
  };
  return { hermes, seeded };
}

async function fixture(fail = false) {
  const root = await mkdtemp(join(tmpdir(), 'helena-agent-context-'));
  roots.push(root);
  const hermesHome = join(root, 'hermes');
  const { hermes, seeded } = seedingHermes(fail);
  const materializer = new HermesPolicyMaterializer({ hermesHome, context: { reader: hermes } });
  return { hermesHome, materializer, seeded };
}

describe('compression settings', () => {
  it("become Hermes' compression keys and the summarising model", () => {
    expect(
      hermesCompressionConfig({
        thresholdTokens: 100_000,
        targetRatio: 0.3,
        idleCompactAfterSeconds: 3600,
        model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
      }),
    ).toEqual({
      compression: {
        threshold_tokens: 100_000,
        target_ratio: 0.3,
        idle_compact_after_seconds: 3600,
      },
      auxiliary: { compression: { provider: 'openai-codex', model: 'gpt-5.6-luna' } },
    });
    expect(hermesCompressionConfig({ thresholdTokens: 80_000 })).toEqual({
      compression: { threshold_tokens: 80_000 },
    });
    expect(hermesCompressionConfig(undefined)).toEqual({});
  });

  it('are written into the managed configuration beside the learning settings', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply(snapshot('sha256:c', { compression: { thresholdTokens: 90_000 } }));
    const config = await managed(hermesHome);
    expect(config.compression).toEqual({ threshold_tokens: 90_000 });
    // The learning contribution's auxiliary settings stay next to it.
    expect(config.auxiliary.background_review).toEqual({ enabled: false });
  });

  it("leave local AI's compression helper out when the agent names its own model", () => {
    const localAi: RuntimeLocalAi = {
      servers: [
        {
          provider: 'helena-local',
          baseUrl: 'http://127.0.0.1:13305/api/v1',
          keyEnv: 'HELENA_MODEL_SERVER_KEY_LOCAL',
          contextLength: 65536,
          models: [{ id: 'Qwen3.6-35B-A3B-GGUF' }],
        },
      ],
      helpers: [
        { task: 'compression', provider: 'helena-local', model: 'Qwen3.6-35B-A3B-GGUF' },
        { task: 'vision', provider: 'helena-local', model: 'Qwen3.6-35B-A3B-GGUF' },
      ],
    } as RuntimeLocalAi;
    const collect = (hermes: RuntimePolicySnapshot['hermes']) =>
      collectProfile({
        runtime: 'hermes',
        snapshot: { ...snapshot('r', hermes), localAi },
        env: {},
      }).hermesConfig as { auxiliary: Record<string, { provider: string; model: string }> };
    const own = collect({
      compression: {
        thresholdTokens: 100_000,
        model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
      },
    });
    expect(own.auxiliary.compression).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna' });
    expect(own.auxiliary.vision?.provider).toBe('helena-local');
    const helper = collect({ compression: { thresholdTokens: 100_000 } });
    expect(helper.auxiliary.compression).toMatchObject({ provider: 'helena-local' });
  });
});

describe('the skills that ship with Hermes', () => {
  it('are seeded only when asked, in the mode the snapshot names', async () => {
    const { hermesHome, materializer, seeded } = await fixture();
    await materializer.apply(snapshot('sha256:s', { bundledSkills: 'all' }));
    expect(seeded).toEqual([]);
    const result = await materializer.apply(snapshot('sha256:s', { bundledSkills: 'all' }), {
      seedBundledSkills: true,
    });
    expect(seeded).toEqual([{ home: hermesHome, mode: 'all' }]);
    expect(result.bundledSkills).toEqual({ copied: 3, updated: 0, userModified: 0, total: 60 });
    // An older server names no mode: nothing is seeded.
    await materializer.apply(snapshot('sha256:t'), { seedBundledSkills: true });
    expect(seeded).toHaveLength(1);
  });

  it('never keep a revision from applying when seeding fails', async () => {
    const { materializer } = await fixture(true);
    const result = await materializer.apply(snapshot('sha256:f', { bundledSkills: 'essential' }), {
      seedBundledSkills: true,
    });
    expect(result.revision).toBe('sha256:f');
    expect(result.bundledSkills).toEqual({ error: "Hermes' Python failed with 1" });
  });

  it('are seeded once per revision and runner start, not at every check', async () => {
    const { materializer, seeded } = await fixture();
    const values = [
      snapshot('sha256:one', { bundledSkills: 'all' }),
      snapshot('sha256:one', { bundledSkills: 'all' }),
      snapshot('sha256:two', { bundledSkills: 'all' }),
    ];
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => {
        const next = values.shift();
        if (!next) throw new Error('server unreachable');
        return next;
      },
      reportRuntimeStatus: async (status) => {
        statuses.push(status);
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
    };
    const sync = new HermesPolicySynchronizer(client, materializer);
    await sync.ensure();
    await sync.ensure();
    await sync.ensure();
    expect(seeded).toHaveLength(2);
    expect(statuses.every((status) => status.status === 'online')).toBe(true);
  });
});
