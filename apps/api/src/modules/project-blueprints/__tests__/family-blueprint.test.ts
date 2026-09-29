import { expect, it } from 'bun:test';
import { join } from 'node:path';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import { readBundleDir } from '@helena/sdk/bundles';
import { parseBlueprintJson, validateBundle } from '@helena/sdk';
import { planBlueprint, type BlueprintState } from '../plan';

const repo = join(import.meta.dir, '../../../../../..');
const family = readBlueprintDir(join(repo, 'blueprints/family'));
const personal = ['personal-priv', 'personal-elli'].map((name) =>
  readBlueprintDir(join(repo, 'blueprints', name)),
);
const pool = readBundleDir(join(repo, 'bundles/agent-pool'));

it('preserves equal personal capabilities, scoped family specialists and existing schedule times', () => {
  expect(validateBundle(pool)).toEqual([]);
  expect(personal.map((blueprint) => blueprint.agents.map((agent) => agent.template))).toEqual([
    ['assistant', 'finance'],
    ['assistant', 'finance'],
  ]);
  expect(family.agents.map((agent) => agent.template)).toEqual([
    'assistant',
    'schule-kita',
    'baby-gesundheit',
  ]);
  for (const blueprint of [...personal, family]) {
    expect(blueprint.routines).toEqual([]);
    expect(blueprint.coordinator).toMatchObject({ model: 'gpt-6-luna', runnerScope: 'team' });
    for (const agent of blueprint.agents)
      expect(pool.agents.some((template) => template.name === agent.template)).toBe(true);
  }
  expect(personal[1]!.goals.find((goal) => goal.title.startsWith('Mail'))!.status).toBe('paused');
});

it('plans explicit model and member-chat scope changes once, without granting project membership', () => {
  const blueprint = personal[1]!;
  const profile = (username: string) => ({
    id: 1,
    userId: 'bot',
    username,
    template: false,
    sourceTemplateId: null,
    instructions: '',
    skills: [],
    projectKeys: ['ELLI'],
    assignment: null,
    departmentId: 2,
    projectBrowser: true,
    memoryApproval: false,
    tools: [],
    model: 'old',
    runnerScope: 'owner',
  });
  const state: BlueprintState = {
    departments: [{ id: 2, name: 'Familie & Privat' }],
    project: {
      id: 9,
      key: 'ELLI',
      name: 'Elli',
      departmentId: 2,
      instructions: blueprint.project.instructions,
    },
    areas: [],
    agents: ['elli-koordinator', 'assistant-elli', 'finance-elli'].map(profile),
    library: [],
    network: null,
    existingFiles: [],
    boards: [],
    goals: [],
    routineKeys: [],
    credentials: [],
    agentTools: [],
    connectorTools: {},
    defaultCoordinatorInstructions: '',
  };
  const first = planBlueprint(blueprint, state, ['agents']);
  expect(first.changes.filter((change) => change.kind === 'agentProfile')).toHaveLength(3);
  expect(first.changes.some((change) => change.kind === 'copy')).toBe(false);
  const updated = {
    ...state,
    agents: state.agents.map((agent) => ({ ...agent, model: 'gpt-6-luna', runnerScope: 'team' })),
  };
  expect(
    planBlueprint(blueprint, updated, ['agents']).changes.filter(
      (change) => change.kind === 'agentProfile',
    ),
  ).toEqual([]);
  const multiProject = {
    ...state,
    agents: state.agents.map((agent) => ({ ...agent, projectKeys: ['ELLI', 'PRIV'] })),
  };
  expect(planBlueprint(blueprint, multiProject, ['agents']).blockers).toHaveLength(3);
  expect(() =>
    parseBlueprintJson(JSON.stringify({ ...blueprint, coordinator: { runnerScope: 'god' } })),
  ).toThrow();
});
