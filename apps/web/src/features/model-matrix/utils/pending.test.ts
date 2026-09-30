import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  MatrixAgentRow,
  MatrixProfile,
  MatrixSchema,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';
import {
  EMPTY_PENDING,
  agentGroup,
  buildPatch,
  clearAgentColumn,
  clearSchemaCell,
  discardSchema,
  discardSchemaRole,
  isEmpty,
  pendingCount,
  pruneSchemaRole,
  schemaRoleValues,
  setAgentRole,
  setAgentValue,
  setSchemaCells,
} from './pending';

const values = {
  runtime: 'helena',
  model: 'volition-local-default',
  reasoning: 'high',
  escalation: { target: 'runtime:codex/gpt-6-sol', failures: 2, stalledSteps: 12, onRequest: true },
  browser: 'jev',
  decision: { backend: 'jev-local', threshold: 0.8, fallback: 'gpu', privateData: false },
  device: 'gpu',
} as const;
const schema = (id: string, profile: string): MatrixSchema => ({
  id,
  name: id,
  description: '',
  profile,
  roles: { general: values as never, coder: values as never },
  classes: {},
  npuSlots: 0,
  gpuSlots: 4,
  speechRecognition: 'cpu',
  jevPrivate: true,
});
const profile = (id: string): MatrixProfile => ({
  id,
  name: id,
  npu: id === 'local-27b-npu',
  classes: { triage: { device: 'npu', model: 'qwen3.5:2b', eval: 'passed' } },
  npuSlots: 1,
  gpuSlots: 4,
  speechRecognition: 'cpu',
});
const row = (id: number, own: string[] = []): MatrixAgentRow => ({
  id,
  teamId: 1,
  username: `a${id}`,
  role: 'coder',
  project: null,
  schemaId: 'nur-lokal',
  cells: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      {
        value: key === 'model' && own.includes('model') ? 'gpt-6-sol' : value,
        source: own.includes(key) ? 'own' : 'schema',
      },
    ]),
  ) as never,
});
const matrix = (rows: MatrixAgentRow[]): ModelMatrix =>
  ({
    revision: 7,
    active: 'nur-lokal',
    schemas: {
      'nur-lokal': schema('nur-lokal', 'local-halogen'),
      gemischt: schema('gemischt', 'local-halogen'),
    },
    profiles: [profile('local-halogen'), profile('local-27b-npu')],
    projects: {},
    agents: rows,
    classes: [],
    local: { model: null, maintenance: null, job: null },
    browser: null,
  }) as never;

describe('Vorgemerkte Änderungen der Matrix', () => {
  test('sammelt Werte je Agent und Spalte, Zurücksetzen ist null', () => {
    let pending = setAgentValue(EMPTY_PENDING, 5, 'model', 'gpt-6-sol');
    pending = setAgentValue(pending, 5, 'reasoning', null);
    pending = setAgentRole(pending, 6, 'reviewer');
    assert.equal(pendingCount(pending), 3);
    const patch = buildPatch(matrix([row(5), row(6)]), pending);
    assert.equal(patch.expectedRevision, 7);
    assert.deepEqual(patch.agents, [
      { agentId: 5, values: { model: 'gpt-6-sol', reasoning: null } },
      { agentId: 6, role: 'reviewer', values: {} },
    ]);
    assert.equal(patch.active, undefined);
  });

  test('nimmt eine Spalte wieder heraus und räumt den leeren Agenten ab', () => {
    const pending = clearAgentColumn(setAgentValue(EMPTY_PENDING, 5, 'model', 'x'), 5, 'model');
    assert.equal(isEmpty(pending), true);
    assert.deepEqual(pending.agents, {});
  });

  test('Schema und Profil gehen als Schema-Änderung des aktiven Schemas', () => {
    const pending = {
      ...EMPTY_PENDING,
      active: 'gemischt',
      profile: 'local-27b-npu',
      projects: { 2: 'gemischt', 3: null },
    };
    const patch = buildPatch(matrix([]), pending);
    assert.equal(patch.active, 'gemischt');
    assert.equal(patch.schema?.id, 'gemischt');
    assert.equal(patch.schema?.profile, 'local-27b-npu');
    assert.equal(patch.schema?.npuSlots, 1);
    assert.deepEqual(patch.projects, [
      { projectId: 2, schemaId: 'gemischt' },
      { projectId: 3, schemaId: null },
    ]);
  });

  test('Gruppen: Home, Koordinatoren, Spezialisten', () => {
    assert.equal(agentGroup('general', null, true), 'home');
    assert.equal(agentGroup('home'), 'home');
    assert.equal(agentGroup('general', 'coordinator'), 'coordinator');
    assert.equal(agentGroup('coder', 'specialist'), 'specialist');
  });
});

describe('Vorgemerkte Änderungen an den Rollen eines eigenen Schemas', () => {
  const own = (): ModelMatrix => {
    const base = matrix([]);
    return {
      ...base,
      schemas: {
        ...base.schemas,
        eigenes: {
          ...schema('eigenes', 'local-halogen'),
          roles: { general: values as never },
        },
      },
    } as never;
  };

  test('eine geänderte Zelle zählt einmal und geht als ganzes Schema an den Server', () => {
    const pending = setSchemaCells(EMPTY_PENDING, 'eigenes', 'general', { reasoning: 'low' });
    assert.equal(pendingCount(pending), 1);
    const patch = buildPatch(own(), pending);
    assert.equal(patch.schema?.id, 'eigenes');
    assert.equal(patch.schema?.roles.general?.reasoning, 'low');
    assert.equal(patch.schema?.roles.general?.model, 'volition-local-default');
    assert.equal('builtIn' in (patch.schema ?? {}), false);
  });

  test('das Zurücksetzen einer Zelle räumt die Rolle und das Schema ab', () => {
    let pending = setSchemaCells(EMPTY_PENDING, 'eigenes', 'general', { reasoning: 'low' });
    pending = clearSchemaCell(pending, 'eigenes', 'general', 'reasoning');
    assert.equal(isEmpty(pending), true);
    assert.deepEqual(pending.schemas, {});
  });

  test('ein Wert, der wieder dem gespeicherten entspricht, ist keine Änderung mehr', () => {
    const pending = pruneSchemaRole(
      setSchemaCells(EMPTY_PENDING, 'eigenes', 'general', { reasoning: 'high', device: 'cpu' }),
      own(),
      'eigenes',
      'general',
    );
    assert.deepEqual(pending.schemas.eigenes?.general?.values, { device: 'cpu' });
  });

  test('eine neue Rolle beginnt bei der Rolle „Allgemein“ des Schemas', () => {
    const pending = setSchemaCells(EMPTY_PENDING, 'eigenes', 'coder', {}, true);
    assert.equal(pendingCount(pending), 1);
    const entry = schemaRoleValues(own(), pending, 'eigenes', 'coder');
    assert.equal(entry?.added, true);
    assert.equal(entry?.values.model, 'volition-local-default');
    const patch = buildPatch(own(), pending);
    assert.deepEqual(Object.keys(patch.schema?.roles ?? {}).sort(), ['coder', 'general']);
  });

  test('ein leeres Schema ohne „Allgemein“ übernimmt die lokalen Vorgaben', () => {
    const base = own();
    const empty = {
      ...base,
      schemas: { ...base.schemas, leer: { ...base.schemas.eigenes!, id: 'leer', roles: {} } },
    } as ModelMatrix;
    const pending = setSchemaCells(EMPTY_PENDING, 'leer', 'general', {}, true);
    assert.equal(schemaRoleValues(empty, pending, 'leer', 'general')?.values.runtime, 'helena');
  });

  test('eine verworfene Rolle und ein gelöschtes Schema verschwinden aus der Liste', () => {
    let pending = setSchemaCells(EMPTY_PENDING, 'eigenes', 'coder', {}, true);
    pending = setSchemaCells(pending, 'eigenes', 'general', { device: 'cpu' });
    assert.equal(pendingCount(discardSchemaRole(pending, 'eigenes', 'coder')), 1);
    assert.deepEqual(discardSchema(pending, 'eigenes').schemas, {});
  });

  test('Profil und Rollen desselben Schemas gehen in einer Schema-Änderung', () => {
    const base = own();
    const active = { ...base, active: 'eigenes' } as ModelMatrix;
    const pending = {
      ...setSchemaCells(EMPTY_PENDING, 'eigenes', 'general', { device: 'cpu' }),
      profile: 'local-27b-npu',
    };
    const patch = buildPatch(active, pending);
    assert.equal(patch.schema?.profile, 'local-27b-npu');
    assert.equal(patch.schema?.roles.general?.device, 'cpu');
    assert.equal(patch.schemas, undefined);
  });

  test('mehrere Schemata gehen als Liste, ohne dass eines doppelt vorkommt', () => {
    const base = own();
    const two = {
      ...base,
      schemas: {
        ...base.schemas,
        zweites: { ...base.schemas.eigenes!, id: 'zweites' },
      },
    } as ModelMatrix;
    const pending = setSchemaCells(
      setSchemaCells(EMPTY_PENDING, 'eigenes', 'general', { device: 'cpu' }),
      'zweites',
      'general',
      { device: 'cpu' },
    );
    const patch = buildPatch(two, pending);
    assert.equal(patch.schema, undefined);
    assert.deepEqual(patch.schemas?.map((entry) => entry.id).sort(), ['eigenes', 'zweites']);
  });
});
