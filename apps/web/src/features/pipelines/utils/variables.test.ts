import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { newStep } from './editorState';
import { insertVariable, variablesAt } from './variables';

const step = (kind: PipelineStep['type'], id: string) => newStep(kind, id, id, []);

// implement → review? → yes: [notes] / no: [wait] → publish
const tree: PipelineStep[] = [
  step('agent', 'implement'),
  {
    ...(step('condition', 'review') as Extract<PipelineStep, { type: 'condition' }>),
    then: [step('agent', 'notes')],
    else: [step('wait', 'pause')],
  },
  step('action', 'publish'),
];

describe('workflow variables', () => {
  test('the first step reads the task only', () => {
    const variables = variablesAt(tree, 'implement');
    assert.deepEqual(variables.previous, []);
    assert.deepEqual(variables.steps, []);
    assert.ok(variables.task.includes('task.title'));
  });

  test('a step in a lane reads the steps before its condition', () => {
    const variables = variablesAt(tree, 'notes');
    assert.deepEqual(
      variables.steps.map((entry) => entry.id),
      ['implement'],
    );
    assert.deepEqual(variables.previous, ['previous.summary', 'previous.outcome', 'previous.note']);
  });

  test('a step after a condition reads the result steps of both lanes', () => {
    const variables = variablesAt(tree, 'publish');
    assert.deepEqual(
      variables.steps.map((entry) => entry.id),
      ['implement', 'notes'],
    );
    assert.deepEqual(variables.steps[1]?.variables, [
      'step.notes.summary',
      'step.notes.outcome',
      'step.notes.note',
    ]);
  });

  test('puts the variable in at the caret or over the selection', () => {
    assert.deepEqual(insertVariable('Hello !', 'task.title', { start: 6, end: 6 }), {
      text: 'Hello {{task.title}}!',
      caret: 20,
    });
    assert.deepEqual(
      insertVariable('Hello X', 'task.title', { start: 6, end: 7 }).text,
      'Hello {{task.title}}',
    );
  });
});
