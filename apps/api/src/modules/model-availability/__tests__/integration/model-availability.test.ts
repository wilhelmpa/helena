import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRun, aiAgent, db, helenaModelAvailability, issueActivity } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { loadProjectContext } from '#modules/pipelines/project-context';
import { learnFromHistory } from '../../history';

// What Helena learns about the models the providers serve this account: a run the provider
// refused takes its model out of the pickers, fails once and is named on the task; a success
// confirms a model; the owner lets a model be tried again; a template copy on a refused model
// runs on the runtime's default; every agent can be moved off a refused model at once.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const REFUSAL = {
  code: 'model-unavailable',
  retryable: false,
  model: 'gpt-6-terra',
  detail: "The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.",
};

function model(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high'],
    thinkingDefault: 'low',
    provider: 'openai-codex',
    ...fields,
  };
}

// The catalog the live runner published on 2026-09-24, in short: what the account lists,
// what Hermes adds, and a large-context variant.
const CATALOG = [
  model('gpt-5.6-terra', { listed: true }),
  model('gpt-6-sol', { listed: false }),
  model('gpt-6-terra', { listed: false }),
  model('gpt-6-terra-900k', { listed: false, variantOf: 'gpt-6-terra' }),
  model('claude-sonnet-5', { provider: 'anthropic', thinkingLevels: ['low', 'max'] }),
];

function report(requested: string | null, used: string | null = requested) {
  return {
    requested: { model: requested, reasoning: 'medium', provider: 'openai-codex' },
    defaults: { model: 'gpt-5.6-luna', provider: 'openai-codex', reasoning: 'low' },
    used: used ? { model: used, reasoning: 'medium', provider: null } : null,
  };
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const teamId = view.project.teamId;
  const created = (
    await createAgent(asOwner, 'MKT', {
      name: 'QA',
      username: 'qa',
      kind: 'external',
      triggerOnMention: true,
      model: 'gpt-6-terra',
      runtimePolicy: {
        reasoningEffort: 'medium',
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
      },
    })
  ).data!;
  const asRunner = apiKeyApi(created.apiKey!);
  await asRunner['agent-chats'].catalog.post({ models: CATALOG as never });
  return {
    asOwner,
    asRunner,
    teamId,
    projectId: view.project.id,
    columnId: view.columns[0]!.id,
    agent: created.agent,
  };
}

async function mention(asOwner: Api, columnId: number) {
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Test it' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please test @qa' });
  return issue;
}

function catalogOf(asOwner: Api, agentId: number) {
  return asOwner.projects({ projectKey: 'MKT' })['ai-agents']({ agentId }).chat.catalog.get();
}

async function refuseByRun(ctx: Awaited<ReturnType<typeof setup>>) {
  const issue = await mention(ctx.asOwner, ctx.columnId);
  const run = (await ctx.asRunner['agent-runs'].claim.post()).data!.run!;
  const res = await ctx.asRunner['agent-runs']({ runId: run.id }).result.post({
    status: 'failed',
    output: "ChatGPT or Codex Subscription rejected the request and retrying won't help.",
    error: `HTTP 400: {"detail":"${REFUSAL.detail}"}\nsession_id: 20260924_191027_ae3ffa`,
    failure: REFUSAL,
    runtime: report('gpt-6-terra'),
  });
  expect(res.status).toBe(200);
  return { issue, run };
}

describe('model availability', () => {
  beforeEach(resetDb);

  it('takes a model the provider refused out of the pickers and names it on the task', async () => {
    const ctx = await setup();
    const before = (await catalogOf(ctx.asOwner, ctx.agent.id)).data!;
    // Hermes only expects gpt-6-sol to work; the account lists gpt-5.6-terra.
    expect(before.models.find((m) => m.id === 'gpt-6-sol')?.verified).toBe(false);
    expect(before.models.find((m) => m.id === 'gpt-5.6-terra')?.verified).toBe(true);
    expect(before.models.find((m) => m.id === 'claude-sonnet-5')).not.toHaveProperty('verified');
    expect(before.unavailable).toEqual([]);

    const { issue, run } = await refuseByRun(ctx);

    const [stored] = await db.select().from(agentRun).where(eq(agentRun.id, run.id));
    expect(stored).toMatchObject({ status: 'failed', failure: REFUSAL });
    const [finding] = await db.select().from(helenaModelAvailability);
    expect(finding).toMatchObject({
      runtime: 'hermes',
      provider: 'openai-codex',
      model: 'gpt-6-terra',
      state: 'unavailable',
      reason: 'model-unavailable',
      detail: REFUSAL.detail,
      agentId: ctx.agent.id,
      runId: run.id,
    });

    // Gone from the pickers, with its variant, and named apart for the editor.
    const after = (await catalogOf(ctx.asOwner, ctx.agent.id)).data!;
    expect(after.models.map((m) => m.id)).toEqual([
      'gpt-5.6-terra',
      'gpt-6-sol',
      'claude-sonnet-5',
    ]);
    expect(after.unavailable.map((m) => m.id)).toEqual(['gpt-6-terra', 'gpt-6-terra-900k']);
    expect(after.unavailable[0]).toMatchObject({
      provider: 'openai-codex',
      detail: REFUSAL.detail,
    });

    // The run's history and the task say why.
    const runs = (
      await ctx.asOwner
        .teams({ teamId: ctx.teamId })
        ['ai-agents']({ agentId: ctx.agent.id })
        .runs.get()
    ).data!.items;
    expect(runs[0]).toMatchObject({ id: run.id, failure: REFUSAL });
    const entries = await db
      .select({ payload: issueActivity.payload })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, issue.id), eq(issueActivity.action, 'agent_finished')));
    expect(entries.map((entry) => entry.payload)).toContainEqual(
      expect.objectContaining({
        subject: { value: 'model-unavailable' },
        to: { value: 'gpt-6-terra' },
      }),
    );

    // Nothing runs it again: the queue has nothing for the runner.
    expect((await ctx.asRunner['agent-runs'].claim.post()).data!.run).toBeNull();

    // A chat cannot pick it any more.
    const sent = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'Try it', model: 'gpt-6-terra' });
    expect(sent.status).toBe(400);

    // The workflow builder offers it no more as a step's model.
    const context = await loadProjectContext({ id: ctx.projectId, key: 'MKT', teamId: ctx.teamId });
    expect(context.models).not.toContain('gpt-6-terra');
  });

  it('records a success, which clears a refusal and confirms a model the account does not list', async () => {
    const ctx = await setup();
    await refuseByRun(ctx);

    // The model came back (the owner's plan changed): a chat answer on it works.
    await db.update(aiAgent).set({ model: 'gpt-6-sol' }).where(eq(aiAgent.id, ctx.agent.id));
    const sent = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'Hello', model: 'gpt-6-sol' });
    expect(sent.status).toBe(200);
    const claimed = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'success',
      runtime: report('gpt-6-sol'),
    });
    const sol = (await catalogOf(ctx.asOwner, ctx.agent.id)).data!.models.find(
      (m) => m.id === 'gpt-6-sol',
    );
    expect(sol?.verified).toBe(true);

    // A success on the refused model itself lifts the refusal.
    const issue = await mention(ctx.asOwner, ctx.columnId);
    const run = (await ctx.asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run.issueId).toBe(issue.id);
    await ctx.asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'Done',
      runtime: report('gpt-6-terra'),
    });
    const after = (await catalogOf(ctx.asOwner, ctx.agent.id)).data!;
    expect(after.unavailable).toEqual([]);
    expect(after.models.find((m) => m.id === 'gpt-6-terra')?.verified).toBe(true);

    // A fallback model that answered says nothing about the one asked for.
    await db.delete(helenaModelAvailability);
    const chat = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'Again', model: 'gpt-6-terra' });
    const second = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    expect(chat.status).toBe(200);
    await ctx.asRunner['agent-chats']({ messageId: second.id }).result.post({
      status: 'success',
      runtime: report('gpt-6-terra', 'gpt-5.6-terra'),
    });
    expect(await db.select().from(helenaModelAvailability)).toEqual([]);
  });

  it('names a chat answer the provider refused, and records it', async () => {
    const ctx = await setup();
    const sent = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'Hello', model: 'gpt-6-terra' });
    const claimed = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).events.post({
      events: [
        {
          type: 'RUN_ERROR',
          message: 'HTTP 400: not supported',
          code: 'model-unavailable',
        },
      ],
    });
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'failed',
      error: 'HTTP 400: not supported',
      failure: REFUSAL,
      runtime: report('gpt-6-terra'),
    });
    const messages = (
      await ctx.asOwner
        .projects({ projectKey: 'MKT' })
        ['ai-agents']({ agentId: ctx.agent.id })
        .threads({ threadId: sent.data!.threadId })
        .messages.get()
    ).data!;
    expect(messages.items.at(-1)).toMatchObject({
      role: 'assistant',
      error: 'HTTP 400: not supported',
      errorCode: 'model-unavailable',
      errorModel: 'gpt-6-terra',
    });
    expect((await catalogOf(ctx.asOwner, ctx.agent.id)).data!.unavailable.map((m) => m.id)).toEqual(
      ['gpt-6-terra', 'gpt-6-terra-900k'],
    );
  });

  it('lists the findings with the agents on a refused model, and forgets one on request', async () => {
    const ctx = await setup();
    await refuseByRun(ctx);
    const listed = (await ctx.asOwner.teams({ teamId: ctx.teamId })['model-availability'].get())
      .data!;
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).toMatchObject({
      model: 'gpt-6-terra',
      state: 'unavailable',
      agents: [{ id: ctx.agent.id, username: 'qa', template: false }],
    });
    const health = (await ctx.asOwner.god['system-health'].get()).data!;
    expect(health.models.unavailable).toEqual([
      expect.objectContaining({
        model: 'gpt-6-terra',
        agents: [expect.objectContaining({ id: ctx.agent.id, username: 'qa' })],
      }),
    ]);
    expect((await ctx.asOwner.god['model-availability'].get()).data!.entries).toHaveLength(1);

    const cleared = await ctx.asOwner
      .teams({ teamId: ctx.teamId })
      ['model-availability']({ entryId: listed.entries[0]!.id })
      .delete();
    expect(cleared.status).toBe(204);
    expect((await catalogOf(ctx.asOwner, ctx.agent.id)).data!.unavailable).toEqual([]);
    expect(
      (
        await ctx.asOwner
          .teams({ teamId: ctx.teamId })
          ['model-availability']({ entryId: listed.entries[0]!.id })
          .delete()
      ).status,
    ).toBe(404);
  });

  it('copies a template on a refused model onto the runtime default, and syncs no refused model', async () => {
    const ctx = await setup();
    await refuseByRun(ctx);
    const agents = ctx.asOwner.teams({ teamId: ctx.teamId })['ai-agents'];
    const template = (
      await agents.post({
        name: 'QA & Tests',
        username: 'qa-template',
        kind: 'external',
        template: true,
        model: 'gpt-6-terra',
        runtimePolicy: {
          reasoningEffort: 'medium',
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          files: [],
        },
      })
    ).data!.agent;
    const copied = await agents({ agentId: template.id }).copy.post({ projectId: ctx.projectId });
    expect(copied.status).toBe(201);
    expect(copied.data!.agent).toMatchObject({ model: null, sourceTemplateId: template.id });
    expect(copied.data!.agent.runtimePolicy.reasoningEffort).toBeNull();
    expect(copied.data!.modelFallback).toEqual({ model: 'gpt-6-terra', detail: REFUSAL.detail });

    // A change of the template's reasoning carries the model group, not the refused model.
    await agents({ agentId: template.id }).patch({
      runtimePolicy: { ...template.runtimePolicy, reasoningEffort: 'high' },
    });
    const [copy] = await db
      .select({ model: aiAgent.model })
      .from(aiAgent)
      .where(eq(aiAgent.id, copied.data!.agent.id));
    expect(copy!.model).toBeNull();

    // A template on a model that works is copied as it is.
    await agents({ agentId: template.id }).patch({ model: 'gpt-5.6-terra' });
    await ctx.asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const ops = (await ctx.asOwner.projects({ projectKey: 'OPS' }).get()).data!.project.id;
    const plain = await agents({ agentId: template.id }).copy.post({ projectId: ops });
    expect(plain.data!.agent.model).toBe('gpt-5.6-terra');
    expect(plain.data!).not.toHaveProperty('modelFallback');
  });

  it('learns once from the refusals the runs before it met', async () => {
    const ctx = await setup();
    // A run an older runner reported: the refusal is only in its words.
    await mention(ctx.asOwner, ctx.columnId);
    const run = (await ctx.asRunner['agent-runs'].claim.post()).data!.run!;
    await ctx.asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'failed',
      output:
        "ChatGPT or Codex Subscription rejected the request and retrying won't help.\n\n" +
        `Provider said: HTTP 400: {"detail":"${REFUSAL.detail.replace(/"/g, '\\"')}"}`,
      error: 'session_id: 20260924_190648_b02504',
      runtime: report('gpt-6-terra'),
    });
    await db.delete(helenaModelAvailability);
    const lines: string[] = [];
    const dry = await learnFromHistory({ days: 1, apply: false, log: (line) => lines.push(line) });
    expect(dry).toEqual({ read: 1, refused: 1 });
    expect(lines[0]).toContain('would learn: run');
    expect(await db.select().from(helenaModelAvailability)).toEqual([]);

    expect(await learnFromHistory({ days: 1, apply: true, log: () => {} })).toEqual({
      read: 1,
      refused: 1,
    });
    const [stored] = await db.select().from(agentRun).where(eq(agentRun.id, run.id));
    expect(stored!.failure).toMatchObject({ code: 'model-unavailable', model: 'gpt-6-terra' });
    expect(await db.select().from(helenaModelAvailability)).toEqual([
      expect.objectContaining({
        runtime: 'hermes',
        provider: 'openai-codex',
        model: 'gpt-6-terra',
        state: 'unavailable',
        runId: run.id,
      }),
    ]);
    // Nothing left to learn.
    expect(await learnFromHistory({ days: 1, apply: true, log: () => {} })).toEqual({
      read: 0,
      refused: 0,
    });
  });

  it('names the agents whose model runs through a Hermes login the provider rejected', async () => {
    const ctx = await setup();
    const agents = ctx.asOwner.teams({ teamId: ctx.teamId })['ai-agents'];
    const writer = (
      await agents.post({
        projectIds: [ctx.projectId],
        name: 'Writer',
        username: 'writer',
        kind: 'external',
        model: 'claude-sonnet-5',
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          files: [],
        },
      } as never)
    ).data!.agent;
    // Its runner's catalog no longer lists the Claude models (the keeper's catalog leaves a
    // provider with a dead login out); the model's family still names the provider.
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'logins-'));
    const saved = process.env.HELENA_LOGIN_STATUS_DIR;
    process.env.HELENA_LOGIN_STATUS_DIR = dir;
    try {
      const login = (state: string) => ({
        version: 1,
        reporter: 'helena-token-keeper',
        checkedAt: new Date().toISOString(),
        intervalSeconds: 600,
        logins: [
          {
            store: 'hermes',
            provider: 'anthropic',
            id: 'abc123',
            label: null,
            managed: true,
            state,
            expiresAt: null,
            refreshedAt: null,
            error: null,
            command: 'hermes auth add anthropic --type oauth',
          },
        ],
        errors: [],
      });
      await writeFile(join(dir, 'hermes.json'), JSON.stringify(login('invalid')));
      const listed = (await ctx.asOwner.teams({ teamId: ctx.teamId })['model-availability'].get())
        .data!;
      expect(listed.deadLogins).toEqual([
        {
          provider: 'anthropic',
          state: 'invalid',
          command: 'hermes auth add anthropic --type oauth',
          agents: [
            expect.objectContaining({ id: writer.id, username: 'writer', model: 'claude-sonnet-5' }),
          ],
        },
      ]);
      const health = (await ctx.asOwner.god['system-health'].get()).data!;
      expect(health.models.deadLogins[0]).toMatchObject({
        provider: 'anthropic',
        agents: [expect.objectContaining({ username: 'writer' })],
      });

      // A login that only failed to renew for now still works: nobody is named.
      await writeFile(join(dir, 'hermes.json'), JSON.stringify(login('error')));
      expect(
        (await ctx.asOwner.teams({ teamId: ctx.teamId })['model-availability'].get()).data!
          .deadLogins,
      ).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.HELENA_LOGIN_STATUS_DIR;
      else process.env.HELENA_LOGIN_STATUS_DIR = saved;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('moves every agent off a model at once, templates carrying their copies', async () => {
    const ctx = await setup();
    const agents = ctx.asOwner.teams({ teamId: ctx.teamId })['ai-agents'];
    const policy = {
      reasoningEffort: 'medium',
      toolAllow: [],
      toolDeny: [],
      mcpGrants: [],
      files: [],
    };
    const template = (
      await agents.post({
        name: 'Data',
        username: 'data-analyst',
        kind: 'external',
        template: true,
        model: 'gpt-6-terra',
        runtimePolicy: policy,
      })
    ).data!.agent;
    const copy = (await agents({ agentId: template.id }).copy.post({ projectId: ctx.projectId }))
      .data!.agent;
    const replace = ctx.asOwner.teams({ teamId: ctx.teamId })['model-availability'].replace;

    const dry = (await replace.post({ from: 'gpt-6-terra', to: 'gpt-5.6-terra', dryRun: true }))
      .data!;
    expect(dry.changed.map((agent) => agent.username).sort()).toEqual(['data-analyst', 'qa']);
    expect(dry.followTemplate).toEqual([{ id: copy.id, username: copy.username }]);
    expect(
      (
        await db.select({ model: aiAgent.model }).from(aiAgent).where(eq(aiAgent.id, template.id))
      )[0]!.model,
    ).toBe('gpt-6-terra');

    const done = (await replace.post({ from: 'gpt-6-terra', to: 'gpt-5.6-terra' })).data!;
    expect(done.changed).toContainEqual({
      id: template.id,
      username: 'data-analyst',
      template: true,
      reasoning: 'medium',
    });
    const models = await db
      .select({ id: aiAgent.id, model: aiAgent.model, overrides: aiAgent.templateOverrides })
      .from(aiAgent);
    for (const id of [template.id, copy.id, ctx.agent.id])
      expect(models.find((row) => row.id === id)!.model).toBe('gpt-5.6-terra');
    // The copy still follows its template.
    expect(models.find((row) => row.id === copy.id)!.overrides).not.toContain('model');

    // Nothing left to move.
    const again = (await replace.post({ from: 'gpt-6-terra', to: 'gpt-5.6-terra' })).data!;
    expect(again).toEqual({ changed: [], followTemplate: [], dryRun: false });

    // Onto the runtime's default: the reasoning level goes with the model.
    const toDefault = (await replace.post({ from: 'gpt-5.6-terra', to: null })).data!;
    expect(toDefault.changed.every((agent) => agent.reasoning === null)).toBe(true);
  });
});
