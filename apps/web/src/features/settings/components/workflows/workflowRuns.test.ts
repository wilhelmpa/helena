import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workflowRunId, workflowRunRows } from './workflowRuns';

describe('workflow run responses', () => {
  it('normalizes both Mastra list response forms', () => {
    const row = { runId: 'run-1', status: 'success' };
    assert.deepEqual(workflowRunRows([row]), [row]);
    assert.deepEqual(workflowRunRows({ runs: [row] }), [row]);
  });

  it('accepts either run id field returned by Mastra', () => {
    assert.equal(workflowRunId({ id: 'run-2', status: 'failed' }), 'run-2');
  });
});
