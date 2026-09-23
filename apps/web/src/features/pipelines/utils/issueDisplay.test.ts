import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import { newStep } from './editorState';
import {
  fieldIssues,
  roleIssues,
  splitIssues,
  stepIssues,
  triggerIssues,
  unplacedStepIssues,
  workflowIssues,
} from './issueDisplay';

const issue = (code: string, stepId: string | null, field: string | null): DefinitionIssue => ({
  code,
  stepId,
  field,
  message: code,
});

const issues = [
  issue('required', 'plan', 'instruction'),
  issue('unreachable_step', 'plan', null),
  issue('role_unresolved', 'plan', 'roles.coder'),
  issue('invalid_cron', null, 'trigger.cron'),
  issue('required', null, 'roles.coder.name'),
  issue('no_steps', null, 'steps'),
  issue('unknown_status', 'move', 'action.status'),
];

describe('workflow issue display', () => {
  test('splits what blocks saving from what blocks enabling', () => {
    const { blocking, warnings } = splitIssues(issues);
    assert.deepEqual(
      warnings.map((item) => item.code),
      ['role_unresolved', 'unknown_status'],
    );
    assert.equal(blocking.length, 5);
  });

  test('finds the issues of a step and of one of its fields', () => {
    assert.equal(stepIssues(issues, 'plan').length, 3);
    assert.deepEqual(
      fieldIssues(issues, 'plan', 'instruction').map((item) => item.code),
      ['required'],
    );
  });

  test('lists the step issues no inspector field shows', () => {
    const step = newStep('agent', 'plan', 'Plan', []);
    assert.deepEqual(
      unplacedStepIssues(issues, step).map((item) => item.code),
      ['unreachable_step', 'role_unresolved'],
    );
  });

  test('puts trigger, role and workflow issues on their cards', () => {
    assert.deepEqual(
      triggerIssues(issues).map((item) => item.code),
      ['invalid_cron'],
    );
    assert.deepEqual(
      roleIssues(issues, 'coder').map((item) => item.code),
      ['role_unresolved', 'required'],
    );
    assert.deepEqual(roleIssues(issues, 'code'), []);
    assert.deepEqual(
      workflowIssues(issues).map((item) => item.code),
      ['no_steps'],
    );
  });
});
