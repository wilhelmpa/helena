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
  isEmpty,
  pendingCount,
  setAgentRole,
  setAgentValue,
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
