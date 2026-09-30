import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { modelSchemaMigration } from '../../../../scripts/model-schema-migrate';
import { escalationPolicy } from '#modules/agents/runner/escalation';
import { aiAgent, appSetting, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { defaultState } from '../../service';

const own = {
  target: 'codex' as const,
  model: 'gpt-6.1-sol',
  afterFailures: 1,
  onResumeLimit: true,
  onRequest: false,
  maxDepth: 1,
};

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MAT', name: 'Matrix' });
  const view = (await api.projects({ projectKey: 'MAT' }).get()).data!;
  const created = (
    await createAgent(api, 'MAT', {
      name: 'Origin',
      username: 'origin',
      kind: 'external',
      triggerOnMention: true,
    })
  ).data!;
  const route = api
    .teams({ teamId: view.project.teamId })
    ['ai-agents']({ agentId: created.agent.id });
  return { api, matrix: api.god['model-schemas'], route, view, created };
}

describe('matrix escalation policy', () => {
  beforeEach(resetDb);

  it('migrates persisted legacy policies and preserves a newer 133b owner policy', async () => {
    const { matrix, route, created } = await setup();
    const state = defaultState();
    const legacy = {
      target: 'runtime:codex/gpt-6-sol',
      failures: 2,
      stalledSteps: 12,
      onRequest: true,
    };
    Object.assign(state.schemas['nur-lokal']!.roles.general!, { escalation: legacy });
    state.history.push({ ...structuredClone(state), revision: 0 });
    await db.insert(appSetting).values({ key: 'volition.modelSchemas', value: state });
    const policy = (await route.get()).data!.runtimePolicy;
    await db
      .update(aiAgent)
      .set({
        modelOverrides: { escalation: legacy },
        runtimePolicy: {
          ...policy,
          escalation: own,
          helena: { escalation: { mode: 'auto', target: legacy.target, onFailure: true } },
        },
      })
      .where(eq(aiAgent.id, created.agent.id));
    const preview = await modelSchemaMigration();
    expect(preview.schemaEscalationMigration).toBe(true);
    expect(preview.applied).toBe(false);
    expect((await modelSchemaMigration(true)).applied).toBe(true);
    expect((await route.get()).data!.runtimePolicy.escalation).toEqual(own);
    expect((await route.get()).data!.runtimePolicy.helena?.escalation).toBeUndefined();
    const migrated = (await matrix.matrix.get()).data!;
    expect(migrated.agents.find((row) => row.id === created.agent.id)?.cells.escalation).toEqual({
      source: 'own',
      value: own,
    });
    expect(migrated.schemas['nur-lokal']!.roles.general!.escalation).toMatchObject({
      model: 'gpt-6.1-sol',
      afterFailures: 2,
      onResumeLimit: true,
    });
    expect((await modelSchemaMigration(true)).applied).toBe(false);
  });

  it('previews, applies and resets all six fields with the correct source', async () => {
    const { matrix, route, created, view } = await setup();
    const initial = (await matrix.matrix.get()).data!;
    expect(initial.agents.find((row) => row.id === created.agent.id)?.cells.escalation.source).toBe(
      'schema',
    );
    const patch = {
      expectedRevision: initial.revision,
      agents: [{ agentId: created.agent.id, values: { escalation: own } }],
    };
    const preview = await matrix.preview.post(patch);
    expect(preview.status).toBe(200);
    expect(preview.data?.changes[0]?.changes).toContainEqual({
      column: 'escalation',
      before: initial.agents.find((row) => row.id === created.agent.id)!.cells.escalation,
      after: { source: 'own', value: own },
    });
    expect((await route.get()).data!.runtimePolicy.escalation).not.toEqual(own);
    expect((await matrix.apply.post(patch)).status).toBe(200);
    expect((await route.get()).data!.runtimePolicy.escalation).toEqual(own);
    expect(await escalationPolicy(created.agent.id)).toEqual(own);
    expect(
      (await matrix.matrix.get()).data!.agents.find((row) => row.id === created.agent.id)?.cells
        .escalation,
    ).toEqual({ source: 'own', value: own });
    expect(
      (
        await matrix.apply.post({
          expectedRevision: initial.revision + 1,
          projects: [{ projectId: view.project.id, schemaId: 'nur-claude' }],
          agents: [{ agentId: created.agent.id, values: { escalation: null } }],
        })
      ).status,
    ).toBe(200);
    const inherited = (await matrix.matrix.get()).data!.agents.find(
      (row) => row.id === created.agent.id,
    )!.cells.escalation;
    expect(inherited.source).toBe('project');
    expect(inherited.value).toMatchObject({
      target: 'claude',
      model: 'claude-opus-5-5',
      afterFailures: 0,
      onResumeLimit: false,
      onRequest: false,
      maxDepth: 0,
    });
    expect((await route.get()).data!.runtimePolicy.escalation).toEqual(inherited.value);
    expect((await route.get()).data!.runtimePolicy.helena?.escalation).toBeUndefined();
  });

  it('reflects agent policy writes and keeps migration idempotent for inherited values', async () => {
    const { api, matrix, route, created } = await setup();
    const inherited = await modelSchemaMigration(true);
    expect(inherited.agents.find((row) => row.id === created.agent.id)?.own).not.toContain(
      'escalation',
    );
    expect((await modelSchemaMigration(true)).applied).toBe(false);
    const policy = (await route.get()).data!.runtimePolicy;
    expect((await route.patch({ runtimePolicy: { ...policy, escalation: own } })).status).toBe(200);
    expect(
      (await matrix.matrix.get()).data!.agents.find((row) => row.id === created.agent.id)?.cells
        .escalation,
    ).toEqual({ source: 'own', value: own });
    const explicit = (
      await createAgent(api, 'MAT', {
        name: 'Explicit',
        username: 'explicit',
        kind: 'external',
        runtimePolicy: {
          runtime: 'codex',
          files: [],
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          escalation: { ...own, target: 'claude', model: null, afterFailures: 5 },
        },
      })
    ).data!;
    expect(
      (await matrix.matrix.get()).data!.agents.find((row) => row.id === explicit.agent.id)?.cells
        .escalation,
    ).toEqual({
      source: 'own',
      value: { ...own, target: 'claude', model: null, afterFailures: 5 },
    });
  });

  it('queues one delegated run using the policy applied through the matrix', async () => {
    const { api, matrix, created, view } = await setup();
    const coder = (
      await createAgent(api, 'MAT', {
        name: 'Coder',
        username: 'coder',
        kind: 'external',
        runtimePolicy: {
          runtime: 'codex',
          files: [],
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
        },
      })
    ).data!;
    const initial = (await matrix.matrix.get()).data!;
    expect(
      (
        await matrix.apply.post({
          expectedRevision: initial.revision,
          agents: [
            {
              agentId: created.agent.id,
              values: { model: 'helena-halogen/halogen-qwen3.8-flash-next', escalation: own },
            },
          ],
        })
      ).status,
    ).toBe(200);
    const issue = (
      await api
        .projects({ projectKey: 'MAT' })
        .issues.post({ columnId: view.columns[0].id, title: 'Matrix failure' })
    ).data!;
    await api.issues({ issueId: issue.id }).comments.post({ body: 'please review @origin' });
    const origin = apiKeyApi(created.apiKey!);
    const target = apiKeyApi(coder.apiKey!);
    const run = (await origin['agent-runs'].claim.post()).data!.run!;
    expect(run).not.toBeNull();
    expect(
      (
        await origin['agent-runs']({ runId: run.id }).result.post({
          status: 'failed',
          error: 'Tests failed',
        })
      ).status,
    ).toBe(200);
    const delegated = (await target['agent-runs'].claim.post()).data!.run!;
    expect(delegated).toMatchObject({ trigger: 'escalation', model: own.model });
    expect(delegated.prompt).toContain('Tests failed');
    expect(
      (
        await target['agent-runs']({ runId: delegated.id }).result.post({
          status: 'failed',
          error: 'Tests failed again',
        })
      ).status,
    ).toBe(200);
    expect((await target['agent-runs'].claim.post()).data!.run).toBeNull();
    expect((await origin['agent-runs'].claim.post()).data!.run).toBeNull();
  });
});
