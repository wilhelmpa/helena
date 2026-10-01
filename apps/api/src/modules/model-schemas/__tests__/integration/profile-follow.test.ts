import { beforeEach, describe, expect, it } from 'bun:test';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { LOCAL_DEFAULT } from '#modules/local-ai/maintenance-state';
import { applyMatrix, modelMatrix, readModelState } from '../../service';
import { followLocalProfile, restoreActiveSchema } from '../../profile-follow';
import { MODEL_TEMPLATES, PROFILE_SCHEMAS } from '../../templates';

const FLASH = 'helena-halogen/halogen-qwen3.8-flash-next';
const BIG = 'helena-volition-lemonade/Qwen3.8-27B-GGUF';

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'PFL', name: 'Profile follow' });
  const make = async (username: string) =>
    (await createAgent(api, 'PFL', { name: username, username, kind: 'external' })).data!.agent;
  const pin = (id: number, model: string, extra: Record<string, unknown> = {}) =>
    db
      .update(aiAgent)
      .set({ model, modelOverrides: { model, ...extra } })
      .where(eq(aiAgent.id, id));
  const read = async (id: number) =>
    (
      await db
        .select({ model: aiAgent.model, overrides: aiAgent.modelOverrides })
        .from(aiAgent)
        .where(eq(aiAgent.id, id))
    )[0]!;
  return { api, make, pin, read };
}

describe('built-in local schemas per profile', () => {
  it('has one built-in local schema for each local profile, with the classes of the profile', () => {
    expect(PROFILE_SCHEMAS).toEqual({
      'local-halogen': 'nur-lokal',
      'local-27b-npu': 'nur-lokal-27b',
    });
    for (const [profile, id] of Object.entries(PROFILE_SCHEMAS))
      expect(MODEL_TEMPLATES[id]!.profile).toBe(profile as keyof typeof PROFILE_SCHEMAS);
    const npu = (id: string) =>
      Object.entries(MODEL_TEMPLATES[id]!.classes)
        .filter(([, placement]) => placement.device === 'npu')
        .map(([name]) => name)
        .sort();
    expect(npu('nur-lokal')).toEqual([]);
    expect(npu('nur-lokal-27b')).toEqual(['hermes-helpers', 'routines', 'triage']);
    expect(MODEL_TEMPLATES['nur-lokal-27b']!.npuSlots).toBe(1);
    // Chat and agent roles follow the loaded model, whichever profile it belongs to.
    expect(
      Object.values(MODEL_TEMPLATES['nur-lokal-27b']!.roles).every(
        (values) => values.runtime === 'helena' && values.model === LOCAL_DEFAULT,
      ),
    ).toBe(true);
  });
});

describe('a local profile carries the schema and the model pins', () => {
  beforeEach(resetDb);

  it('moves a local active schema to the one of the profile and back, with audit and undo', async () => {
    await setup();
    expect((await readModelState()).active).toBe('nur-lokal');
    const dry = await followLocalProfile('local-27b-npu', { dryRun: true });
    expect(dry).toMatchObject({
      changed: true,
      applied: false,
      from: 'nur-lokal',
      to: 'nur-lokal-27b',
    });
    expect((await readModelState()).active).toBe('nur-lokal');
    const forward = await followLocalProfile('local-27b-npu');
    expect(forward).toMatchObject({
      changed: true,
      applied: true,
      from: 'nur-lokal',
      to: 'nur-lokal-27b',
    });
    const matrix = await modelMatrix();
    expect(matrix.active).toBe('nur-lokal-27b');
    expect(matrix.schemas['nur-lokal-27b']!.profile).toBe('local-27b-npu');
    expect(matrix.classes.some((entry) => entry.device === 'npu')).toBe(true);
    // Nothing left to do the second time.
    expect(await followLocalProfile('local-27b-npu')).toMatchObject({ changed: false });
    const back = await followLocalProfile('local-halogen');
    expect(back).toMatchObject({ changed: true, from: 'nur-lokal-27b', to: 'nur-lokal' });
    expect((await modelMatrix()).active).toBe('nur-lokal');
    // It is an ordinary matrix change: undo takes it back.
    const state = await readModelState();
    await applyMatrix({ expectedRevision: state.revision, undo: true });
    expect((await readModelState()).active).toBe('nur-lokal-27b');
  });

  it('points a pin of a profile model at the local default and keeps every other own setting', async () => {
    const { make, pin, read } = await setup();
    const flash = await make('pinned-flash');
    const big = await make('pinned-big');
    const other = await make('pinned-other');
    const cloud = await make('pinned-cloud');
    await pin(flash.id, FLASH);
    await pin(big.id, BIG);
    await pin(other.id, 'helena-local/Some-Other-Model');
    await pin(cloud.id, FLASH, { runtime: 'codex' });
    const result = await followLocalProfile('local-27b-npu');
    expect(result.changed).toBe(true);
    for (const agent of [flash, big]) {
      const row = await read(agent.id);
      expect(row.overrides.model).toBeUndefined();
      expect(row.model).toBe(LOCAL_DEFAULT);
    }
    expect((await read(other.id)).overrides.model).toBe('helena-local/Some-Other-Model');
    expect((await read(cloud.id)).overrides).toMatchObject({ model: FLASH, runtime: 'codex' });
    // The matrix shows them under the schema again, not as an own setting.
    const rows = (await modelMatrix()).agents;
    expect(rows.find((row) => row.id === flash.id)!.cells.model).toEqual({
      value: LOCAL_DEFAULT,
      source: 'schema',
    });
    expect(rows.find((row) => row.id === other.id)!.cells.model.source).toBe('own');
  });

  it('leaves a mixed schema in place but still repairs pins to a model that is not loaded', async () => {
    const { make, pin, read } = await setup();
    const agent = await make('mixed-pin');
    await pin(agent.id, FLASH);
    const state = await readModelState();
    await applyMatrix({ expectedRevision: state.revision, active: 'gemischt' });
    const result = await followLocalProfile('local-27b-npu');
    expect(result.changed).toBe(true);
    expect((await readModelState()).active).toBe('gemischt');
    expect((await read(agent.id)).model).toBe(LOCAL_DEFAULT);
    // Neither is a cloud schema.
    const next = await readModelState();
    await applyMatrix({ expectedRevision: next.revision, active: 'nur-claude' });
    await followLocalProfile('local-halogen');
    expect((await readModelState()).active).toBe('nur-claude');
  });

  it('moves projects that follow a local schema, not those with another one', async () => {
    const { api } = await setup();
    const view = (await api.projects({ projectKey: 'PFL' }).get()).data!;
    const state = await readModelState();
    await applyMatrix({
      expectedRevision: state.revision,
      projects: [{ projectId: view.project.id, schemaId: 'nur-lokal' }],
    });
    await followLocalProfile('local-27b-npu');
    expect((await readModelState()).projects[view.project.id]).toBe('nur-lokal-27b');
    const next = await readModelState();
    await applyMatrix({
      expectedRevision: next.revision,
      projects: [{ projectId: view.project.id, schemaId: 'nur-codex' }],
    });
    await followLocalProfile('local-halogen');
    expect((await readModelState()).projects[view.project.id]).toBe('nur-codex');
  });

  it('takes the active schema back only while nobody changed it meanwhile', async () => {
    await setup();
    await followLocalProfile('local-27b-npu');
    expect(await restoreActiveSchema('nur-lokal', 'nur-lokal-27b')).toBe(true);
    expect((await readModelState()).active).toBe('nur-lokal');
    const state = await readModelState();
    await applyMatrix({ expectedRevision: state.revision, active: 'nur-codex' });
    expect(await restoreActiveSchema('nur-lokal', 'nur-lokal-27b')).toBe(false);
    expect((await readModelState()).active).toBe('nur-codex');
  });

  it('names the schemas per profile, repairs a profile that was changed and has a route', async () => {
    const { api } = await setup();
    const state = await readModelState();
    expect(state.schemas['nur-lokal']!.name).toBe('Nur lokal – Flash');
    expect(state.schemas['nur-lokal-27b']!.name).toBe('Nur lokal – 27B + NPU');
    // Someone gave the Flash schema the 27B profile (the matrix still allows it on built-ins).
    const definition = (await modelMatrix()).profiles.find(
      (entry) => entry.id === 'local-27b-npu',
    )!;
    expect(definition.schema).toBe('nur-lokal-27b');
    await applyMatrix({
      expectedRevision: state.revision,
      schema: {
        ...state.schemas['nur-lokal']!,
        profile: 'local-27b-npu',
        classes: definition.classes,
        npuSlots: definition.npuSlots,
        gpuSlots: definition.gpuSlots,
        speechRecognition: definition.speechRecognition,
      },
    });
    expect((await readModelState()).schemas['nur-lokal']!.profile).toBe('local-27b-npu');
    const repaired = await followLocalProfile('local-halogen');
    expect(repaired.changed).toBe(true);
    expect((await readModelState()).schemas['nur-lokal']).toMatchObject({
      profile: 'local-halogen',
      npuSlots: 0,
    });
    const response = await api.god['model-schemas']['follow-profile'].post({
      profile: 'local-27b-npu',
      dryRun: true,
    });
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ changed: true, applied: false, to: 'nur-lokal-27b' });
  });
});
