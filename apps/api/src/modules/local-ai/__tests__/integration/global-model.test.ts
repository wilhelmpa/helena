import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiAgent,
  appSetting,
  db,
  helenaModelServer,
  helenaLocalAiEval,
  readLocalAiPolicy,
  setSetting,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { api, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { runtimePolicySnapshot } from '#modules/agents/runtime-policy/service';
import {
  publishChatCatalog,
  readChatCatalog,
  readTeamChatCatalog,
} from '#modules/agents/chat/service';
import { useHostdTransport } from '#modules/server/hostd';
import { chooseModelNow } from '../../service';
import {
  beginGlobalModel,
  bulkLocalDefault,
  localDefaultClassFallback,
  previewGlobalModel,
  resumeGlobalModel,
} from '../../global-model';
import {
  DEFAULT_KEY,
  LOCAL_DEFAULT,
  MAINTENANCE_KEY,
  readMaintenance,
  readUncachedSetting,
  withModelAdmission,
  type MaintenanceState,
} from '../../maintenance-state';

let directory: string;
const originalFetch = globalThis.fetch;
const old = { server: 'halogen' as const, slug: 'halogen', model: 'Flash' };
const target = { server: 'lemonade' as const, slug: 'local', model: 'Qwen27B' };
const state = (phase = 'done'): MaintenanceState => ({
  version: 1,
  active: old,
  admissionPaused: phase !== 'done',
  proxyPaused: phase !== 'done',
  startsBlocked: phase !== 'done',
  operation:
    phase === 'done'
      ? null
      : { id: 'fake', target, previous: old, phase, error: null, journal: [] },
});
const save = (value: MaintenanceState) =>
  writeFile(process.env.VOLITION_MODEL_MAINTENANCE_STATE!, JSON.stringify(value));

function pairedCatalogs() {
  globalThis.fetch = (async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return Response.json(
      url.includes('13309')
        ? { data: [{ id: 'qwen3.5:2b' }] }
        : {
            status: 'ok',
            data: [{ id: 'Qwen3.8-27B-GGUF', downloaded: true, labels: ['tool-calling'] }],
          },
    );
  }) as typeof fetch;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'volition-model-test-'));
  process.env.VOLITION_MODEL_MAINTENANCE_STATE = join(directory, 'state.json');
});
afterAll(async () => {
  useHostdTransport(null);
  globalThis.fetch = originalFetch;
  delete process.env.VOLITION_MODEL_MAINTENANCE_STATE;
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  await save(state());
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 'ok', data: [], models: [] }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  useHostdTransport(async (method, parameters) => {
    const current = (await readMaintenance())!;
    if (method === 'ModelMaintenanceStatus') return current;
    if (method !== 'SwitchModelServer') throw new Error('Unexpected host operation');
    if (parameters.action === 'begin') {
      const next = state('drain');
      next.operation!.id = String(parameters.id);
      next.operation!.target = parameters.target as NonNullable<MaintenanceState['active']>;
      next.operation!.previous = parameters.previous as NonNullable<MaintenanceState['active']>;
      await save(next);
      return next;
    }
    if (parameters.action === 'rollback') {
      current.operation!.phase = 'rollback-pause';
      await save(current);
      return current;
    }
    const phases = [
      'drain',
      'pause',
      'block-starts',
      'stop',
      'free-gpu',
      'start',
      'health',
      'probe',
      'commit',
      'release',
      'eval',
      'done',
    ];
    const next = structuredClone(current);
    next.operation!.phase = phases[phases.indexOf(current.operation!.phase) + 1]!;
    await save(next);
    return next;
  });
  for (const [kind, slug, model, port, enabled] of [
    ['halogen', 'halogen', 'Flash', 8731, true],
    ['lemonade', 'local', 'Qwen27B', 13305, false],
  ] as const)
    await db.insert(helenaModelServer).values({
      slug,
      name: slug,
      kind,
      keySource: 'none',
      baseUrl: `http://127.0.0.1:${port}/${kind === 'lemonade' ? 'api/v1' : 'v1'}`,
      enabled,
      checkedAt: new Date(),
      status: { reachable: enabled, version: null, latencyMs: 1, error: null, loaded: [] },
      models: [
        {
          id: model,
          name: model,
          unit: 'gpu',
          capabilities: ['chat', 'tools'],
          loaded: enabled,
          downloaded: true,
          backend: null,
          contextLength: 65536,
          sizeBytes: null,
        },
      ],
    });
  await setSetting('localAi.policy', {
    enabled: true,
    initialized: true,
    units: { gpu: true, cpu: true, npu: true },
    classes: {},
  });
  await setSetting(DEFAULT_KEY, 'helena-halogen/Flash');
});

async function fixture() {
  const owner = await signUpTestUser();
  const client = authedApi(owner.cookie);
  const project = (await client.projects.post({ name: 'Model test', key: 'M114' })).data!;
  const agent = await createAgent(client, project.key, {
    username: 'model-test',
    name: 'Model test',
    kind: 'external',
    model: 'gpt-6-luna',
  });
  expect(agent.status).toBe(201);
  return { client, agent: agent.data!.agent, teamId: project.teamId };
}

describe('global local model API', () => {
  it('resolves the local default in native runner configuration after each switch', async () => {
    const { agent } = await fixture();
    await db
      .update(aiAgent)
      .set({ model: LOCAL_DEFAULT, runtimePolicy: { ...agent.runtimePolicy, runtime: 'helena' } })
      .where(eq(aiAgent.id, agent.id));
    const runner = await getRunnerAgent(agent.userId);
    expect(runner).not.toBeNull();
    const before = await runtimePolicySnapshot(runner!);
    expect(before.model).toBe('helena-halogen/Flash');
    await setSetting(DEFAULT_KEY, 'helena-local/Qwen27B');
    const after = await runtimePolicySnapshot(runner!);
    expect(after.model).toBe('helena-local/Qwen27B');
    expect(after.revision).not.toBe(before.revision);
  });

  it('offers the switched local default to Helena chats with a stale runner catalog', async () => {
    const { client, agent, teamId } = await fixture();
    await db
      .update(aiAgent)
      .set({ runtimePolicy: { ...agent.runtimePolicy, runtime: 'helena' } })
      .where(eq(aiAgent.id, agent.id));
    const expected = 'helena-halogen/Flash';
    expect((await readChatCatalog(agent.id)).models.some((model) => model.id === expected)).toBe(
      true,
    );
    await publishChatCatalog(agent.id, []);
    expect((await readChatCatalog(agent.id)).models.some((model) => model.id === expected)).toBe(
      true,
    );
    expect((await readTeamChatCatalog(teamId)).models.some((model) => model.id === expected)).toBe(
      true,
    );
    const sent = await client.teams({ teamId })['ai-agents']({ agentId: agent.id }).chat.post({
      prompt: 'Which local model answers?',
      model: LOCAL_DEFAULT,
    });
    expect(sent.status).toBe(200);
  });

  it('previews and begins the paired profile with empty catalogs and no NPU registration', async () => {
    await db
      .update(helenaModelServer)
      .set({ models: [] })
      .where(eq(helenaModelServer.slug, 'local'));
    const preview = await previewGlobalModel('helena-local/Qwen3.8-27B-GGUF', 'local-27b-npu');
    expect(preview.target).toMatchObject({ server: 'lemonade', npu: 'qwen3.5:2b' });
    expect((await readMaintenance())?.operation).toBeNull();
    expect((await db.select().from(helenaModelServer)).some((s) => s.slug === 'volition-npu')).toBe(
      false,
    );
    expect(
      (await beginGlobalModel('helena-local/Qwen3.8-27B-GGUF', 'local-27b-npu')).operation?.phase,
    ).toBe('drain');
  });

  it('registers missing paired servers after startup without replacing embeddings', async () => {
    await db
      .update(helenaModelServer)
      .set({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:13308/v1', models: [] })
      .where(eq(helenaModelServer.slug, 'local'));
    await beginGlobalModel('helena-volition-lemonade/Qwen3.8-27B-GGUF', 'local-27b-npu');
    const pending = (await readMaintenance())!;
    pending.operation!.phase = 'commit';
    await save(pending);
    await resumeGlobalModel();
    expect((await readMaintenance())?.operation?.phase).toBe('commit');
    expect(await readUncachedSetting<string>(DEFAULT_KEY)).toBe('helena-halogen/Flash');
    // Tests use anonymous fixture servers; no host credentials are read.
    await db
      .update(helenaModelServer)
      .set({ keySource: 'none', keyFile: null })
      .where(eq(helenaModelServer.kind, 'lemonade'));
    await db
      .update(helenaModelServer)
      .set({ keySource: 'none', keyFile: null })
      .where(eq(helenaModelServer.kind, 'fastflowlm'));
    pairedCatalogs();
    await resumeGlobalModel();
    expect((await readMaintenance())?.operation?.phase).toBe('release');
    expect(await readUncachedSetting<string>(DEFAULT_KEY)).toBe(
      'helena-volition-lemonade/Qwen3.8-27B-GGUF',
    );
    const servers = await db.select().from(helenaModelServer);
    expect(servers.find((s) => s.slug === 'local')).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:13308/v1',
    });
    expect(servers.find((s) => s.slug === 'volition-npu')).toMatchObject({ enabled: true });
  });

  it('rejects bootstrap targets outside the managed profile', async () => {
    for (const model of ['helena-unmanaged/Qwen3.8-27B-GGUF', 'helena-local/other'])
      await expect(previewGlobalModel(model, 'local-27b-npu')).rejects.toThrow();
    await db
      .update(helenaModelServer)
      .set({ baseUrl: 'http://127.0.0.1:9999/v1', models: [] })
      .where(eq(helenaModelServer.slug, 'local'));
    await expect(
      previewGlobalModel('helena-local/Qwen3.8-27B-GGUF', 'local-27b-npu'),
    ).rejects.toThrow();
  });

  it('rolls back a catalog timeout before publishing the new default', async () => {
    await db
      .update(helenaModelServer)
      .set({ models: [] })
      .where(eq(helenaModelServer.slug, 'local'));
    await db.insert(helenaModelServer).values({
      slug: 'volition-npu',
      name: 'NPU',
      kind: 'fastflowlm',
      baseUrl: 'http://127.0.0.1:13309/v1',
      keySource: 'none',
      enabled: false,
    });
    await beginGlobalModel('helena-local/Qwen3.8-27B-GGUF', 'local-27b-npu');
    const pending = (await readMaintenance())!;
    pending.operation!.phase = 'commit';
    await save(pending);
    const job = (await readUncachedSetting<Record<string, unknown>>(MAINTENANCE_KEY))!;
    await setSetting(MAINTENANCE_KEY, { ...job, catalogStartedAt: Date.now() - 240_001 });
    expect((await resumeGlobalModel())?.operation?.phase).toBe('rollback-pause');
    expect(await readUncachedSetting<string>(DEFAULT_KEY)).toBe('helena-halogen/Flash');
  });

  it('accepts an explicit Gemma selection only in the paired profile', async () => {
    const { client } = await fixture();
    expect(
      (
        await client.god['local-ai'].default.preview.post({
          model: 'helena-local/Qwen3.8-27B-GGUF',
          profile: 'local-27b-npu',
          npuModel: 'gemma4-it:e4b',
        })
      ).data?.target.npu,
    ).toBe('gemma4-it:e4b');
    expect(
      (
        await client.god['local-ai'].default.preview.post({
          model: 'helena-halogen/Flash',
          profile: 'local-halogen',
          npuModel: 'gemma4-it:e2b',
        })
      ).status,
    ).toBe(400);
  });
  it('requires owner access and validates targets without host side effects', async () => {
    expect((await api.god['local-ai'].default.get()).status).toBe(401);
    const { client } = await fixture();
    const member = await signUpTestUser();
    expect((await authedApi(member.cookie).god['local-ai'].default.get()).status).toBe(403);
    expect(
      (await client.god['local-ai'].default.preview.post({ model: 'gpt-6-luna' })).status,
    ).toBe(400);
    const preview = await client.god['local-ai'].default.preview.post({
      model: 'helena-local/Qwen27B',
    });
    expect(preview.data).toMatchObject({ weightLockGb: 72, simultaneousLargeModels: false });
    expect((await readMaintenance())?.operation).toBeNull();
  });

  it('bulk preview preserves settings; apply makes only selected agents follow the standard', async () => {
    const { client, agent, teamId } = await fixture();
    const preview = await bulkLocalDefault([agent.id], false);
    expect(preview.agents[0]?.model).toBe('gpt-6-luna');
    expect((await db.select().from(aiAgent).where(eq(aiAgent.id, agent.id)))[0]?.model).toBe(
      'gpt-6-luna',
    );
    await bulkLocalDefault([agent.id], true);
    expect((await chooseModelNow(LOCAL_DEFAULT, null)).model).toBe('helena-halogen/Flash');
    const patched = await client
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        model: LOCAL_DEFAULT,
        runtimePolicy: { ...agent.runtimePolicy, reasoningEffort: 'low' },
      });
    expect(patched.status).toBe(200);
    const picker = await client
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .chat['model-picker'].get();
    expect(picker.data?.agentDefault.model).toBe('helena-halogen/Flash');
    expect(picker.data?.groups[0]?.models.map((m) => m.status)).toEqual(['running', 'not-loaded']);
  });

  it('persists the switch, fences admission and atomically commits the default', async () => {
    const started = await beginGlobalModel('helena-local/Qwen27B');
    expect(started.operation?.phase).toBe('drain');
    let ran = false;
    expect(
      await withModelAdmission(async () => {
        ran = true;
      }),
    ).toBeNull();
    expect(ran).toBe(false);
    const waiting = await readMaintenance();
    waiting!.operation!.phase = 'commit';
    await save(waiting!);
    await resumeGlobalModel();
    expect((await readMaintenance())?.operation?.phase).toBe('release');
    const { localDefaultModel } = await import('../../maintenance-state');
    expect(await localDefaultModel()).toBe('helena-local/Qwen27B');
    const servers = await db.select().from(helenaModelServer);
    expect(servers.find((s) => s.slug === 'halogen')?.enabled).toBe(false);
    expect(servers.find((s) => s.slug === 'local')?.enabled).toBe(true);
  });

  it('restores the prior default, policy and enabled servers after an interrupted commit', async () => {
    await beginGlobalModel('helena-local/Qwen27B');
    let pending = (await readMaintenance())!;
    pending.operation!.phase = 'commit';
    await save(pending);
    await resumeGlobalModel();
    const committed = await readUncachedSetting<Record<string, unknown>>(MAINTENANCE_KEY);
    // Repeating the same barrier after a lost host reply must preserve the rollback snapshot.
    pending = (await readMaintenance())!;
    pending.operation!.phase = 'commit';
    await save(pending);
    await resumeGlobalModel();
    expect(await readUncachedSetting<Record<string, unknown>>(MAINTENANCE_KEY)).toEqual(committed);
    pending = (await readMaintenance())!;
    pending.operation!.phase = 'rollback-commit';
    await save(pending);
    await resumeGlobalModel();
    expect(await readUncachedSetting<string>(DEFAULT_KEY)).toBe('helena-halogen/Flash');
    const servers = await db.select().from(helenaModelServer);
    expect(servers.find((server) => server.slug === 'halogen')?.enabled).toBe(true);
    expect(servers.find((server) => server.slug === 'local')?.enabled).toBe(false);
  });

  it('restores an unset default after a failed first switch', async () => {
    await db.delete(appSetting).where(eq(appSetting.key, DEFAULT_KEY));
    await beginGlobalModel('helena-local/Qwen27B');
    const pending = (await readMaintenance())!;
    pending.operation!.phase = 'rollback-commit';
    await save(pending);
    await resumeGlobalModel();
    expect(await readUncachedSetting<string>(DEFAULT_KEY)).toBeNull();
    expect(await readUncachedSetting<Record<string, unknown>>(MAINTENANCE_KEY)).toMatchObject({
      restored: true,
    });
  });

  it('a corrupt state refuses admission and class routes rather than guessing', async () => {
    await writeFile(process.env.VOLITION_MODEL_MAINTENANCE_STATE!, '{');
    await expect(withModelAdmission(async () => true)).rejects.toThrow();
    const { resolveLocalRoute } = await import('@repo/db');
    expect(
      await resolveLocalRoute({ classId: 'triage', unit: 'gpu', capability: 'tools' }),
    ).toEqual({ refusal: 'server-down', mode: 'only' });
  });

  it('failed or pending class evals use cloud until recovery', async () => {
    await setSetting(MAINTENANCE_KEY, {
      committed: true,
      classes: ['triage'],
      done: false,
      failedClasses: [],
    });
    expect(await localDefaultClassFallback('triage')).toBe(true);
    expect(await localDefaultClassFallback('routines')).toBe(false);
    await setSetting(MAINTENANCE_KEY, {
      committed: true,
      classes: ['triage'],
      done: true,
      failedClasses: ['triage'],
    });
    expect(await localDefaultClassFallback('triage')).toBe(true);
    await setSetting(MAINTENANCE_KEY, {
      committed: true,
      restored: true,
      classes: ['triage'],
      done: true,
      failedClasses: ['triage'],
    });
    expect(await localDefaultClassFallback('triage')).toBe(false);
  });
});

it('pairs only the 27B GPU with NPU, gates classes and restores both server flags', async () => {
  const { client } = await fixture();
  const [gpu] = await db
    .select()
    .from(helenaModelServer)
    .where(eq(helenaModelServer.slug, 'local'));
  await db
    .update(helenaModelServer)
    .set({ models: [{ ...gpu!.models[0]!, id: 'Qwen3.8-27B-GGUF' }] })
    .where(eq(helenaModelServer.id, gpu!.id));
  const [npu] = await db
    .insert(helenaModelServer)
    .values({
      slug: 'volition-npu',
      name: 'NPU',
      kind: 'fastflowlm',
      enabled: false,
      baseUrl: 'http://127.0.0.1:13309/v1',
      keySource: 'none',
    })
    .returning();
  expect(
    (
      await client.god['local-ai'].default.preview.post({
        model: 'helena-halogen/Flash',
        profile: 'local-27b-npu',
      })
    ).status,
  ).toBe(400);
  const preview = await client.god['local-ai'].default.preview.post({
    model: 'helena-local/Qwen3.8-27B-GGUF',
    profile: 'local-27b-npu',
  });
  expect(preview.status).toBe(200);
  expect(preview.data).toMatchObject({
    npuClasses: ['triage', 'routines', 'hermes-helpers'],
    target: { npu: 'qwen3.5:2b' },
  });
  const policy = await readLocalAiPolicy();
  policy.classes.triage = { mode: 'prefer', model: null };
  policy.classes['hermes-helpers'] = { mode: 'prefer', model: null };
  await setSetting('localAi.policy', policy);
  await beginGlobalModel('helena-local/Qwen3.8-27B-GGUF', 'local-27b-npu');
  let pending = (await readMaintenance())!;
  pending.operation!.target.npu = 'qwen3.5:2b';
  pending.operation!.phase = 'commit';
  await save(pending);
  pairedCatalogs();
  await resumeGlobalModel();
  expect(
    (await db.select().from(helenaModelServer).where(eq(helenaModelServer.id, npu!.id)))[0]
      ?.enabled,
  ).toBe(true);
  expect((await readLocalAiPolicy()).classes.triage?.mode).toBe('off');
  const job = (await readUncachedSetting<{ classes: string[]; startedAt: string }>(
    MAINTENANCE_KEY,
  ))!;
  for (const classId of job.classes) {
    const small = ['triage', 'routines', 'hermes-helpers'].includes(classId);
    await db.insert(helenaLocalAiEval).values({
      classId,
      serverId: small ? npu!.id : gpu!.id,
      model: small ? 'qwen3.5:2b' : 'Qwen3.8-27B-GGUF',
      score: classId === 'hermes-helpers' ? 0 : 1,
      threshold: 0.85,
      passed: classId !== 'hermes-helpers',
      cases: 24,
      ranAt: new Date(Date.parse(job.startedAt) + 1),
      status: 'done',
    });
  }
  pending = (await readMaintenance())!;
  pending.operation!.phase = 'eval';
  pending.admissionPaused = false;
  await save(pending);
  await resumeGlobalModel();
  expect((await readLocalAiPolicy()).classes.triage).toEqual({
    mode: 'prefer',
    model: 'helena-volition-npu/qwen3.5:2b',
  });
  expect((await readLocalAiPolicy()).classes['hermes-helpers']?.mode).toBe('off');
  expect(await localDefaultClassFallback('hermes-helpers')).toBe(true);
  expect((await readLocalAiPolicy()).classes.routines?.model).toBe(
    'helena-volition-npu/qwen3.5:2b',
  );
  pending = (await readMaintenance())!;
  pending.operation!.phase = 'rollback-commit';
  await save(pending);
  await resumeGlobalModel();
  expect(
    (await db.select().from(helenaModelServer).where(eq(helenaModelServer.id, npu!.id)))[0]
      ?.enabled,
  ).toBe(false);
  expect((await readLocalAiPolicy()).classes.triage).toEqual(policy.classes.triage);
});
