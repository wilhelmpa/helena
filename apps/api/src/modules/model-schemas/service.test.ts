import { describe, expect, it } from 'bun:test';
import {
  UNDO_DEPTH,
  changedRows,
  defaultState,
  nextState,
  resolveRow,
  savedAgents,
} from './service';
import { inferModelRole } from '../../scripts/model-schema-migrate';
import { failureDecision } from '#modules/agents/runner/escalation';
import { migrateEscalationValue, migrateSchemaEscalations } from './migration';
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
  it('applies multiple schemas in one revision and restores both on undo', () => {
    const before = defaultState();
    const schemas = ['nur-codex', 'nur-claude'].map((id) => ({
      ...structuredClone(before.schemas[id]!),
      description: 'Updated model schema',
    }));
    const after = nextState(before, { expectedRevision: before.revision, schemas });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.history).toHaveLength(1);
    expect(after.schemas['nur-codex']!.description).toBe('Updated model schema');
    expect(after.schemas['nur-claude']!.description).toBe('Updated model schema');
    expect(nextState(after, { expectedRevision: after.revision, undo: true }).schemas).toEqual(
      before.schemas,
    );
    expect(before.schemas['nur-codex']!.description).not.toBe('Updated model schema');
  });

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

  it('undo goes back one apply at a time, is not itself put on the history and is bounded', () => {
    const start = defaultState();
    const one = nextState(start, { expectedRevision: 0, active: 'nur-codex' });
    // A change of the schema alone keeps an empty list of agents (older entries have none).
    expect(one.history.at(-1)?.agents).toEqual([]);
    const two = nextState(one, { expectedRevision: 1, active: 'nur-claude' });
    const back = nextState(two, { expectedRevision: 2, undo: true });
    expect(back.active).toBe('nur-codex');
    expect(back.revision).toBe(3);
    expect(back.history).toHaveLength(1);
    const first = nextState(back, { expectedRevision: 3, undo: true });
    expect(first.active).toBe('nur-lokal');
    expect(first.history).toHaveLength(0);
    expect(() => nextState(first, { expectedRevision: 4, undo: true })).toThrow();
    let state = start;
    for (let index = 0; index < UNDO_DEPTH + 5; index += 1)
      state = nextState(state, { expectedRevision: state.revision, active: 'nur-codex' });
    expect(state.history).toHaveLength(UNDO_DEPTH);
  });

  it('keeps the agents an apply changed and puts their role and own values back on undo', () => {
    const before = defaultState();
    const own = {
      ...agent,
      id: 2,
      modelRole: 'general',
      modelOverrides: { model: 'custom-model' },
    };
    const patchAgents = [
      { agentId: 1, role: 'reviewer', values: { reasoning: 'low' as const } },
      { agentId: 2, values: { model: null } },
    ];
    const saved = savedAgents([agent, own], patchAgents);
    expect(saved).toEqual([
      { agentId: 1, modelRole: 'coder', modelOverrides: {} },
      { agentId: 2, modelRole: 'general', modelOverrides: { model: 'custom-model' } },
    ]);
    const applied = nextState(before, { expectedRevision: 0, agents: patchAgents }, saved);
    expect(applied.history.at(-1)?.agents).toEqual(saved);
    // The agents as the apply left them.
    const after = [
      { ...agent, modelRole: 'reviewer', modelOverrides: { reasoning: 'low' } },
      { ...own, modelOverrides: {} },
    ];
    const undone = nextState(applied, { expectedRevision: 1, undo: true });
    const rows = changedRows(after, [], applied, undone, [], applied.history.at(-1)?.agents);
    const byId = new Map(rows.map((row) => [row.row.id, row]));
    expect(byId.get(1)?.role).toBe('coder');
    expect(byId.get(1)?.overrides).toEqual({});
    expect(byId.get(1)?.after.cells.reasoning.source).toBe('schema');
    expect(byId.get(2)?.overrides).toEqual({ model: 'custom-model' });
    expect(byId.get(2)?.after.cells.model).toEqual({ value: 'custom-model', source: 'own' });
    // An agent deleted meanwhile is skipped, an undo without saved agents changes none.
    expect(changedRows([], [], applied, undone, [], saved)).toEqual([]);
  });

  it('previews the canonical policy and uses it for the runner decision', () => {
    const before = defaultState();
    const policy = {
      target: 'claude' as const,
      model: 'claude-opus-5-5',
      afterFailures: 2,
      onResumeLimit: true,
      onRequest: false,
      maxDepth: 1,
    };
    const changes = [{ agentId: 1, values: { escalation: policy } }];
    const preview = changedRows([agent], [], before, before, changes);
    expect(preview[0]?.after.cells.escalation).toEqual({ value: policy, source: 'own' });
    expect(preview[0]?.changes).toContainEqual({
      column: 'escalation',
      before: resolveRow(agent, [], before).cells.escalation,
      after: { value: policy, source: 'own' },
    });
    const run = {
      trigger: 'manual',
      continuedFromRunId: null,
      agentId: 1,
      projectId: 1,
      issueId: null,
      attempts: 1,
      failures: 1,
      error: 'Tests failed',
      runtime: 'helena',
      model: 'helena-halogen/halogen-qwen3.8-flash-next',
      configuredModel: 'helena-halogen/halogen-qwen3.8-flash-next',
      modelSource: 'local',
    };
    expect(failureDecision(policy, run)).toBeNull();
    expect(failureDecision(policy, { ...run, failures: 2 })?.model).toBe('claude-opus-5-5');
    expect(failureDecision(policy, { ...run, error: 'Reached resume limit' })?.reason).toBe(
      'resume-limit',
    );
    expect(failureDecision({ ...policy, maxDepth: 0 }, { ...run, failures: 2 })).toBeNull();
  });

  it('uses schema and project policies and rejects old or invalid fields', () => {
    const state = defaultState();
    expect(resolveRow(agent, [], state).cells.escalation).toEqual({
      source: 'schema',
      value: {
        target: 'codex',
        model: 'gpt-6.1-sol',
        afterFailures: 2,
        onResumeLimit: true,
        onRequest: true,
        maxDepth: 1,
      },
    });
    state.projects[1] = 'nur-claude';
    const cloud = resolveRow(agent, [membership(1)], state).cells.escalation;
    expect(cloud).toEqual({
      source: 'project',
      value: {
        target: 'claude',
        model: 'claude-opus-5-5',
        afterFailures: 0,
        onResumeLimit: false,
        onRequest: false,
        maxDepth: 0,
      },
    });
    for (const patch of [
      { afterFailures: 6 },
      { afterFailures: -1 },
      { afterFailures: 1.5 },
      { maxDepth: 2 },
      { target: 'agent:1' },
      { model: 'bad model' },
      { stalledSteps: 12 },
    ]) {
      expect(() =>
        changedRows([agent], [], state, state, [
          {
            agentId: 1,
            values: { escalation: { ...cloud.value, ...patch } as typeof cloud.value },
          },
        ]),
      ).toThrow();
    }
    for (const afterFailures of [0, 5])
      expect(
        changedRows([agent], [], state, state, [
          { agentId: 1, values: { escalation: { ...cloud.value, afterFailures } } },
        ]),
      ).toHaveLength(1);
  });

  it('migrates stored schemas, history and owner values without retaining the old triggers', () => {
    const old = {
      target: 'runtime:claude/claude-opus-5-5',
      failures: 3,
      stalledSteps: 12,
      onRequest: false,
    };
    const expected = {
      target: 'claude' as const,
      model: 'claude-opus-5-5',
      afterFailures: 3,
      onResumeLimit: true,
      onRequest: false,
      maxDepth: 1 as const,
    };
    expect(migrateEscalationValue(old)).toEqual(expected);
    expect(migrateEscalationValue(old, { ...expected, afterFailures: 1 })).toEqual({
      ...expected,
      afterFailures: 1,
    });
    expect(() => migrateEscalationValue({ ...old, target: 'agent:7' })).toThrow(
      'explicit Claude or Codex policy',
    );
    const state = defaultState();
    Object.assign(state.schemas['nur-lokal']!.roles.coder!, { escalation: old });
    state.history.push({ ...structuredClone(state), revision: 0 });
    const migrated = migrateSchemaEscalations(state);
    expect(migrated.schemas['nur-lokal']!.roles.coder!.escalation).toEqual(expected);
    expect(migrated.history[0]?.schemas['nur-lokal']!.roles.coder!.escalation).toEqual(expected);
    expect(migrateSchemaEscalations(migrated)).toEqual(migrated);
    expect(
      resolveRow({ ...agent, modelOverrides: { escalation: old } }, [], state).cells.escalation,
    ).toEqual({ source: 'own', value: expected });
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
