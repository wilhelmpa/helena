import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import {
  addRole,
  findStep,
  insertStep,
  laneDepth,
  localizeDefinition,
  moveStep,
  newStep,
  removeRole,
  removeStep,
  replaceStep,
  roleKeyFor,
  ROOT_LANE,
  starterDefinition,
  stepCount,
  triggerOf,
  uniqueStepId,
} from './editorState';

const agent = (id: string) =>
  newStep('agent', id, id, [{ key: 'coder', name: 'Coder', match: { type: 'none' } }]);
const condition = (id: string, then: PipelineStep[] = [], otherwise: PipelineStep[] = []) => ({
  ...(newStep('condition', id, id, []) as Extract<PipelineStep, { type: 'condition' }>),
  then,
  else: otherwise,
});
const ids = (steps: PipelineStep[]) => steps.map((step) => step.id);

describe('workflow editor state', () => {
  test('inserts a step at a position of the root lane', () => {
    const steps = insertStep([agent('a'), agent('c')], ROOT_LANE, 1, agent('b'));
    assert.deepEqual(ids(steps), ['a', 'b', 'c']);
  });

  test('inserts into a branch of a nested condition and leaves the other lanes alone', () => {
    const tree = [agent('a'), condition('outer', [condition('inner')], [agent('x')])];
    const steps = insertStep(tree, { parentId: 'inner', branch: 'else' }, 0, agent('b'));
    const inner = findStep(steps, 'inner');
    assert.ok(inner?.type === 'condition');
    assert.deepEqual(ids(inner.else), ['b']);
    assert.deepEqual(ids(inner.then), []);
    const outer = findStep(steps, 'outer');
    assert.ok(outer?.type === 'condition');
    assert.deepEqual(ids(outer.else), ['x']);
  });

  test('moves a step within its lane only', () => {
    const tree = [agent('a'), condition('if', [agent('t1'), agent('t2'), agent('t3')])];
    const moved = moveStep(tree, { parentId: 'if', branch: 'then' }, 't3', 't1');
    const branch = findStep(moved, 'if');
    assert.ok(branch?.type === 'condition');
    assert.deepEqual(ids(branch.then), ['t3', 't1', 't2']);
    assert.deepEqual(moveStep(tree, ROOT_LANE, 't1', 'a'), tree);
  });

  test('removes and replaces a step wherever it sits', () => {
    const tree = [agent('a'), condition('if', [agent('t')], [agent('e')])];
    assert.equal(findStep(removeStep(tree, 'e'), 'e'), undefined);
    assert.equal(stepCount(removeStep(tree, 'if')), 1);
    const renamed = replaceStep(tree, 't', { ...agent('t'), name: 'Renamed' });
    assert.equal(findStep(renamed, 't')?.name, 'Renamed');
  });

  test('counts lane depth from the root', () => {
    const tree = [condition('outer', [condition('inner')])];
    assert.equal(laneDepth(tree, ROOT_LANE), 1);
    assert.equal(laneDepth(tree, { parentId: 'outer', branch: 'then' }), 2);
    assert.equal(laneDepth(tree, { parentId: 'inner', branch: 'else' }), 3);
  });

  test('names a new step after its kind, unique in the whole tree', () => {
    const tree = [agent('agent'), condition('if', [agent('agent-2')])];
    assert.equal(uniqueStepId('agent', tree), 'agent-3');
    assert.equal(uniqueStepId('wait', tree), 'wait');
  });

  test('gives an agent step the first role', () => {
    const step = newStep('agent', 'agent', 'Agent', [
      { key: 'writer', name: 'Writer', match: { type: 'none' } },
    ]);
    assert.ok(step.type === 'agent');
    assert.deepEqual(step.assignee, { role: 'writer' });
  });

  test('derives a unique role key from the name', () => {
    const roles = [
      { key: 'content-agent', name: 'Content agent', match: { type: 'none' as const } },
    ];
    assert.equal(roleKeyFor('Content Agent', roles), 'content-agent-2');
    assert.equal(roleKeyFor('Prüfer', []), 'prufer');
    assert.equal(roleKeyFor('42', []), 'role');
    const definition = addRole(
      starterDefinition({ role: 'C', step: 'S', instruction: 'I' }),
      'Writer',
    );
    assert.deepEqual(
      definition.roles.map((role) => role.key),
      ['coordinator', 'writer'],
    );
    assert.deepEqual(
      removeRole(definition, 'coordinator').roles.map((role) => role.key),
      ['writer'],
    );
  });

  test('localizes the step and role names it has translations for', () => {
    const definition = {
      ...starterDefinition({ role: 'Coordinator', step: 'Plan', instruction: 'Do it' }),
      steps: [agent('agent'), condition('if', [agent('inner')])],
    };
    const localized = localizeDefinition(definition, {
      step: (id) => ({ agent: 'Planen', inner: 'Innen' })[id] ?? null,
      role: (key) => (key === 'coordinator' ? 'Koordinator' : null),
    });
    assert.equal(localized.roles[0]?.name, 'Koordinator');
    assert.equal(findStep(localized.steps, 'agent')?.name, 'Planen');
    assert.equal(findStep(localized.steps, 'inner')?.name, 'Innen');
    assert.equal(findStep(localized.steps, 'if')?.name, 'if');
  });

  test('gives a trigger the fields its type needs', () => {
    assert.deepEqual(triggerOf('status_changed'), { type: 'status_changed', to: null });
    assert.deepEqual(triggerOf('manual'), { type: 'manual' });
    const schedule = triggerOf('schedule');
    assert.ok(schedule.type === 'schedule' && schedule.cron && schedule.timezone);
  });
});
