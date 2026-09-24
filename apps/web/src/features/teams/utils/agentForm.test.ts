import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialAgentValue, toCreateInput, toUpdatePatch } from './agentForm';

describe('agent runtime policy form', () => {
  it('keeps runtime policy when an agent is opened', () => {
    const value = initialAgentValue({
      kind: 'external',
      model: 'openai/gpt-5.6-sol',
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
      instructions: null,
      triggerOnMention: true,
      triggerOnAssign: false,
    } as never);

    assert.equal(value.model, 'openai/gpt-5.6-sol');
    assert.equal(value.runtimePolicy.files[0].path, 'instructions/team.md');
  });

  it('normalizes grants and drops an empty managed file before save', () => {
    const value = initialAgentValue();
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

describe('agent projects and templates', () => {
  function named(projectId?: number) {
    const value = initialAgentValue(undefined, projectId);
    value.name = 'Writer';
    value.username = 'writer';
    return value;
  }

  it('creates an agent in the project it was started from', () => {
    const input = toCreateInput(named(7));
    assert.equal(input.projectId, 7);
    assert.equal('projectIds' in input, false);
  });

  it('creates an agent elsewhere with the projects picked in the form', () => {
    const value = named();
    value.projectIds = [3, 4];
    const input = toCreateInput(value);
    assert.deepEqual(input.projectIds, [3, 4]);
    assert.equal('projectId' in input, false);
  });

  it('saves a template without projects', () => {
    const value = named();
    value.projectIds = [3];
    value.template = true;
    const patch = toUpdatePatch(value);
    assert.equal(patch.template, true);
    assert.deepEqual(patch.projectIds, []);
  });
});
