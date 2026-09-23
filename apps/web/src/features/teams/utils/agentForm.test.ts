import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialAgentValue, toUpdatePatch } from './agentForm';

describe('external agent runtime policy form', () => {
  it('keeps runtime policy when an external agent is opened', () => {
    const value = initialAgentValue({
      kind: 'external',
      model: 'openai/gpt-5.6-sol',
      memoryEnabled: true,
      memoryLastMessages: 20,
      runtimePolicy: {
        reasoningEffort: 'high',
        toolAllow: ['browser'],
        toolDeny: [],
        mcpGrants: ['itsaplan__get_issue'],
        files: [{ kind: 'instructions', path: 'instructions/team.md', content: '# Team' }],
      },
      projects: [],
      fieldTriggers: [],
      delegationDelaySec: 120,
      runnerScope: 'team',
      name: 'Runtime agent',
      username: 'runtime',
      modelCredentialId: null,
      instructions: null,
      tools: [],
      temperature: null,
      maxSteps: null,
      triggerOnMention: true,
      triggerOnAssign: false,
    } as never);

    assert.equal(value.model, 'openai/gpt-5.6-sol');
    assert.equal(value.runtimePolicy.files[0].path, 'instructions/team.md');
  });

  it('normalizes grants and drops an empty managed file before save', () => {
    const value = initialAgentValue();
    value.kind = 'external';
    value.name = 'Runtime agent';
    value.username = 'runtime';
    value.model = 'openai/gpt-6-astra';
    value.runtimePolicy = {
      reasoningEffort: 'medium',
      toolAllow: [' browser ', '', 'browser'],
      toolDeny: [],
      mcpGrants: [' plan__get_issue '],
      files: [
        { kind: 'instructions', path: ' SOUL.md ', content: '# Agent' },
        { kind: 'instructions', path: ' ', content: 'draft' },
      ],
    };

    const patch = toUpdatePatch(value);
    assert.equal(patch.model, 'openai/gpt-6-astra');
    assert.deepEqual(patch.runtimePolicy, {
      reasoningEffort: 'medium',
      toolAllow: ['browser'],
      toolDeny: [],
      mcpGrants: ['plan__get_issue'],
      files: [{ kind: 'instructions', path: 'SOUL.md', content: '# Agent' }],
    });
  });
});
