import { expect } from 'bun:test';
import { findState } from '@helena/locales/defaults';
import { authedApi } from './app';
import { signUpTestUser } from './auth';
import { createAgent } from './agents';

// A project with a coordinator and a coder agent, and the workflows of the builder
// around it, for the tests of the builder and of the engine.

export type Json = Record<string, unknown>;

export const agentStep = (
  id: string,
  instruction: string,
  assignee: Json = { role: 'coder' },
  extra: Json = {},
) => ({
  id,
  name: `Step ${id}`,
  type: 'agent',
  assignee,
  instruction,
  maxTurns: null,
  runBudgetSeconds: null,
  model: null,
  timeoutMinutes: 30,
  ...extra,
});

export function definition(steps: Json[], extra: Json = {}) {
  return {
    schemaVersion: 1,
    trigger: { type: 'manual' },
    roles: [
      { key: 'lead', name: 'Lead', match: { type: 'coordinator' } },
      { key: 'coder', name: 'Coder', match: { type: 'none' } },
    ],
    steps,
    ...extra,
  };
}

export const simple = () => definition([agentStep('implement', 'Implement {{task.title}}.')]);

// `locale` names the project's default states in that language; `columnId` finds them by
// their English names too, the way a workflow does (findState).
export async function setupProject(options: { locale?: 'de' } = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({
    key: 'MKT',
    name: 'Marketing',
    ...(options.locale ? { locale: options.locale } : {}),
  });
  const teamId = created.data!.teamId;
  const projectId = created.data!.id;
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columns = view.data!.columns;
  const organization = asOwner.teams({ teamId }).organization;
  const coordinator = (await organization.get()).data!.agents.find(
    (agent) => agent.username === 'hermes-mkt-coordinator',
  )!;
  await organization.agents({ agentId: coordinator.id }).put({ role: 'coordinator' });
  const coder = await createAgent(asOwner, 'MKT', {
    name: 'Coder',
    username: 'coder',
    model: 'luna',
    runtimePolicy: {
      reasoningEffort: null,
      toolAllow: [],
      toolDeny: [],
      mcpGrants: [],
      files: [],
      maxTurns: 8,
    },
  } as never);
  return {
    owner,
    asOwner,
    teamId,
    projectId,
    coordinator,
    coder: coder.data!.agent,
    coderKey: coder.data!.apiKey!,
    columnId: (name: string) => findState(columns, name)!.id,
  };
}

export type ProjectSetup = Awaited<ReturnType<typeof setupProject>>;

export async function template(ctx: ProjectSetup, body: Json = {}) {
  const res = await ctx.asOwner
    .teams({ teamId: ctx.teamId })
    .pipelines.post({ name: 'Release', definition: simple(), ...body } as never);
  expect(res.status).toBe(201);
  return res.data!;
}

export function enable(
  ctx: ProjectSetup,
  pipelineId: number,
  roles: Record<string, number> = {},
  enabled = true,
) {
  return ctx.asOwner
    .projects({ projectKey: 'MKT' })
    .pipelines({ pipelineId })
    .put({ enabled, roles });
}

export async function issue(ctx: ProjectSetup, body: Json = {}) {
  const res = await ctx.asOwner
    .projects({ projectKey: 'MKT' })
    .issues.post({ columnId: ctx.columnId('Todo'), title: 'Launch page', ...body } as never);
  return res.data!;
}

export async function startRun(
  ctx: ProjectSetup,
  issueId: number,
  pipelineId: number,
  dryRun = false,
) {
  const res = await ctx.asOwner.issues({ issueId })['pipeline-runs'].post({ pipelineId, dryRun });
  expect(res.status).toBe(200);
  return res.data!;
}
