import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { runningActivityHref } from './runningLink';

const entry = (over: Partial<AgentActivityEntry>): AgentActivityEntry =>
  ({ id: 'run:5', kind: 'agent-run', status: 'running', at: '', ...over }) as AgentActivityEntry;

describe('the running-agents link', () => {
  it('opens the one run there is', () => {
    const run = entry({ agent: { id: 3 } as AgentActivityEntry['agent'] });
    assert.equal(runningActivityHref([run], null), '/?agentRun=3.5');
    const task = entry({
      project: { key: 'TRADE' } as AgentActivityEntry['project'],
      issue: { sequenceNumber: 9 } as AgentActivityEntry['issue'],
    });
    assert.equal(runningActivityHref([task], 'TRADE'), '/project/TRADE/issue/9');
  });

  it('opens the Verlauf filtered to what is running for none or several', () => {
    assert.equal(runningActivityHref([], null), '/activity?status=running');
    const two = [entry({}), entry({ id: 'run:6' })];
    assert.equal(runningActivityHref(two, 'TRADE'), '/project/TRADE/activity?status=running');
  });
});
