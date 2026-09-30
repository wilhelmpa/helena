import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentAddressQuery } from './legacyAgentAddress';

test('an old agent address names the agent for the overlay', () => {
  const query = new URLSearchParams(agentAddressQuery({ agent: '12', tab: 'runs', run: '3' }));
  assert.equal(query.get('agentSheet'), '12');
  assert.equal(query.get('agentTab'), 'runs');
  assert.equal(query.get('agentRunId'), '3');
  assert.equal(query.has('agent'), false);
});

test('other parameters stay and a repeated one is kept', () => {
  const query = new URLSearchParams(
    agentAddressQuery({ agent: '7', q: ['a', 'b'], skip: undefined }),
  );
  assert.deepEqual(query.getAll('q'), ['a', 'b']);
  assert.equal(query.get('agentSheet'), '7');
  assert.equal(agentAddressQuery({}), '');
});
