import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { WorkflowGate } from '@/lib/api/endpoints/approvals';
import { gateKey, withoutGate } from './workflowGates';

function gate(overrides: Partial<WorkflowGate> = {}): WorkflowGate {
  return {
    projectId: 1,
    projectKey: 'MKT',
    projectName: 'Marketing',
    workflowId: 'support',
    workflowName: 'Support',
    runId: 'run-1',
    reason: null,
    summary: null,
    effects: [],
    createdAt: null,
    ...overrides,
  };
}

describe('workflow gates', () => {
  test('keys a gate by project, workflow and run', () => {
    assert.notEqual(gateKey(gate()), gateKey(gate({ projectKey: 'OPS' })));
    assert.notEqual(gateKey(gate()), gateKey(gate({ workflowId: 'application' })));
    assert.equal(gateKey(gate()), gateKey(gate({ reason: 'Other text' })));
  });

  test('drops only the decided gate and keeps whether the list is complete', () => {
    const decided = gate();
    const other = gate({ workflowId: 'application' });
    assert.deepEqual(withoutGate({ items: [decided, other], complete: false }, decided), {
      items: [other],
      complete: false,
    });
  });

  test('leaves a list that was not read yet alone', () => {
    assert.equal(withoutGate(undefined, gate()), undefined);
  });
});
