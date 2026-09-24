import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { activityDetails, activityTask } from './activityDetails';

const base: AgentActivityEntry = {
  id: 'run:1',
  kind: 'agent-run',
  at: '2026-09-23T10:00:00.000Z',
  status: 'success',
  project: { id: 1, key: 'MKT', name: 'Marketing' },
  agent: { id: 7, username: 'ext', name: 'Ext Bot' },
  issue: { id: 3, identifier: 'MKT-12', sequenceNumber: 12, title: 'Landing page' },
  trigger: 'mention',
  maxTurns: null,
  runBudgetSeconds: null,
  workflowId: null,
  workflowRunId: null,
  threadId: null,
  durationMs: 1000,
  inputTokens: 10,
  outputTokens: 2,
};

describe('agent activity links', () => {
  test('links the task an entry belongs to', () => {
    assert.deepEqual(activityTask(base), {
      href: '/project/MKT/issue/12',
      label: 'MKT-12 Landing page',
    });
    assert.equal(activityTask({ ...base, issue: null }), null);
    assert.equal(activityTask({ ...base, project: null }), null);
  });

  test('opens the conversation of a chat answer', () => {
    const chat = { ...base, kind: 'chat' as const, issue: null, threadId: 'chat:7:u:1' };
    assert.deepEqual(activityDetails(chat), { kind: 'chat', agentId: 7, threadId: 'chat:7:u:1' });
    assert.equal(activityDetails({ ...chat, threadId: null }), null);
  });

  test("opens an agent's run in the glass-box view on the agent's page", () => {
    assert.deepEqual(activityDetails(base), {
      kind: 'page',
      href: '/agents?agent=7&tab=runs&run=1',
    });
    assert.equal(activityDetails({ ...base, agent: null }), null);
  });

  test('opens a workflow run on the Workflows page', () => {
    const run = {
      ...base,
      kind: 'agent-team-run' as const,
      workflowId: 'agent-team',
      workflowRunId: 'a b',
    };
    assert.deepEqual(activityDetails(run), {
      kind: 'page',
      href: '/project/MKT/workflows?workflow=agent-team&run=a+b',
    });
  });
});
