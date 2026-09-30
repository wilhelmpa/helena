import { describe, expect, it } from 'bun:test';
import { changedRows, defaultState, nextState, resolveRow } from './service';
import { inferModelRole } from '../../scripts/model-schema-migrate';
import { escalationReason } from './templates';
import { npuClassModel } from '#modules/local-ai/npu-profile';

const agent = {
  id: 1,
  teamId: 1,
  userId: 'bot',
  username: 'coder',
  agentRole: 'agent',
  projectScope: 'selected',
  modelRole: 'coder',
  modelOverrides: {},
  model: null,
  runtimePolicy: {},
  template: false,
};
const membership = (projectId: number) => ({
  userId: 'bot',
  projectId,
  projectRole: 'project',
  projectKey: `P${projectId}`,
});

describe('model schema resolution', () => {
  it('inherits a project schema only with one project membership', () => {
    const state = defaultState();
    state.projects[1] = 'nur-codex';
    expect(resolveRow(agent, [membership(1)], state).cells.runtime).toEqual({
      value: 'codex',
      source: 'project',
    });
    expect(resolveRow(agent, [membership(1), membership(2)], state).cells.runtime).toEqual({
      value: 'helena',
      source: 'schema',
    });
    expect(resolveRow({ ...agent, agentRole: 'home' }, [membership(1)], state).project).toBeNull();
    expect(
      resolveRow({ ...agent, projectScope: 'all' }, [membership(1)], state).project,
    ).toBeNull();
  });

  it('marks each owner override and falls back after reset', () => {
    const state = defaultState();
    const own = resolveRow({ ...agent, modelOverrides: { runtime: 'claude' } }, [], state);
    expect(own.cells.runtime).toEqual({ value: 'claude', source: 'own' });
    expect(own.cells.model.source).toBe('schema');
    expect(resolveRow(agent, [], state).cells.runtime.source).toBe('schema');
  });

  it('assigns a role from the pool assignment without changing owner values', () => {
    expect(
      inferModelRole(agent, {
        role: 'specialist',
        roleTitle: 'Finanzen und Belege',
        capabilities: [],
      }),
    ).toBe('finance');
    expect(inferModelRole({ ...agent, agentRole: 'home' })).toBe('home');
  });

  it('previews a global switch, keeps own values, and restores the previous schema', () => {
    const before = defaultState();
    const after = nextState(before, { expectedRevision: 0, active: 'nur-codex' });
    const own = { ...agent, id: 2, userId: 'owned', modelOverrides: { model: 'custom-model' } };
    const preview = changedRows([agent, own], [], before, after, []);
    expect(preview).toHaveLength(2);
    expect(preview[0]?.after.cells.runtime.value).toBe('codex');
    expect(preview[1]?.after.cells.model).toEqual({ value: 'custom-model', source: 'own' });
    const restored = nextState(after, { expectedRevision: 1, undo: true });
    expect(resolveRow(agent, [], restored).cells.runtime.value).toBe('helena');
  });

  it('queues escalation only for configured failures, stalls or requests', () => {
    const setting = {
      target: 'runtime:codex/gpt-6-sol',
      failures: 2,
      stalledSteps: 12,
      onRequest: true,
    };
    expect(escalationReason(setting, { attempts: 1, toolCalls: 0, failure: 'error' })).toBeNull();
    expect(escalationReason(setting, { attempts: 2, toolCalls: 0, failure: 'error' })).toBe(
      'repeated failure',
    );
    expect(escalationReason(setting, { attempts: 1, toolCalls: 12, failure: 'loop' })).toBe(
      'stalled',
    );
    expect(escalationReason(setting, { attempts: 0, toolCalls: 0, failure: 'request' })).toBe(
      'requested',
    );
    expect(
      escalationReason(
        { ...setting, onRequest: false },
        { attempts: 0, toolCalls: 0, failure: 'request' },
      ),
    ).toBeNull();
  });

  it('routes only measured NPU chat classes to the 2B model', () => {
    const target = {
      server: 'lemonade' as const,
      slug: 'local',
      model: 'Qwen3.8-27B-GGUF',
      npu: 'qwen3.5:2b' as const,
    };
    expect(npuClassModel(target, 'triage')).toBe('qwen3.5:2b');
    expect(npuClassModel(target, 'routines')).toBe('qwen3.5:2b');
    expect(npuClassModel(target, 'hermes-helpers')).toBe('qwen3.5:2b');
    expect(npuClassModel(target, 'decisions')).toBeNull();
    expect(npuClassModel(target, 'embeddings')).toBeNull();
  });
});
