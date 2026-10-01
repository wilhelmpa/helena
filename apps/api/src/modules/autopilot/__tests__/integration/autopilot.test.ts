import { beforeEach, describe, expect, it } from 'bun:test';
import {
  db,
  aiAgent,
  agentRun,
  agentChatMessage,
  approvalRequest,
  helenaPolicyDecision,
  project,
  projectMember,
  teamMember,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';
import { autopilotPolicyDecider, decideBrowserTool } from '#modules/autopilot/adapters';
import { actionApproved, decide } from '#modules/autopilot/engine';
import type { ActionCategory } from '@helena/sdk';
import {
  budgetStatuses,
  budgetExhausted,
  continueOnce,
  enforceBudgets,
  useGrace,
} from '#modules/autopilot/budgets';
import { autopilotPolicyEvaluator } from '#modules/autopilot/evaluator';

// Helena's Autopilot: one level per project (with an optional per-agent level), one policy
// engine every runtime asks, budgets that stop the work cleanly, and a log entry for each
// decision.

const WS = '/srv/work/mkt';

async function setup(initialLevel: number | null = 1) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  if (initialLevel !== null)
    await asOwner.projects({ projectKey: 'MKT' }).autopilot.put({ level: initialLevel });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
    delegationDelaySec: 0,
  });
  return {
    owner,
    asOwner,
    columnId: view.columns[0]!.id,
    projectId: view.project.id,
    teamId: view.project.teamId,
    agent: created.data!.agent,
    agentKey: created.data!.apiKey!,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function setLevel(asOwner: Api, level: number) {
  const res = await asOwner.projects({ projectKey: 'MKT' }).autopilot.put({ level });
  expect(res.status).toBe(200);
  return res.data!;
}

async function startRun(s: Setup, title = 'Landing page') {
  const issue = (
    await s.asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId: s.columnId, title })
  ).data!;
  await s.asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please look @ext' });
  const run = (await s.asRunner['agent-runs'].claim.post()).data!.run!;
  return { issue, run };
}

function ask(s: Setup, runId: number, call: Record<string, unknown>) {
  return s.asRunner['agent-policy'].decide.post({
    runId,
    runtime: 'hermes',
    tool: 'terminal',
    workspace: WS,
    ...call,
  } as never);
}

async function outcome(s: Setup, runId: number, call: Record<string, unknown>) {
  const res = await ask(s, runId, call);
  expect(res.status).toBe(200);
  return res.data!.outcome;
}

async function comments(asOwner: Api, issueId: number) {
  const feed = await asOwner.issues({ issueId }).feed.get({ query: {} });
  return feed.data!.items.filter((item) => item.kind === 'comment').map((item) => item.body);
}

describe('Autopilot levels', () => {
  beforeEach(resetDb);

  it('starts every project at level 3 and says what each level allows', async () => {
    const { asOwner } = await setup(null);
    const view = (await asOwner.projects({ projectKey: 'MKT' }).autopilot.get()).data!;
    expect(view.level).toBe(3);
    const level1 = view.levels.find((entry) => entry.level === 1)!.rules;
    expect(level1.find((rule) => rule.category === 'write')!.outcome).toBe('allow');
    expect(level1.find((rule) => rule.category === 'send')!.outcome).toBe('needs-approval');
    const level3 = view.levels.find((entry) => entry.level === 3)!.rules;
    expect(
      level3.filter((rule) => rule.outcome !== 'allow').map((r) => `${r.category}:${r.scope}`),
    ).toEqual(['delete:external', 'pay:null', 'credentials:null']);
  });

  it('decides a run’s tool calls by the level, category by category, and logs each', async () => {
    const s = await setup();
    const { run } = await startRun(s);
    const calls = {
      read: { command: 'ls -la && git status' },
      write: { tool: 'write_file', command: undefined, path: `${WS}/notes.md` },
      deleteInside: { command: 'rm -rf build' },
      deleteOutside: { command: 'rm -rf /etc/nginx' },
      publish: { command: 'git push origin main' },
      send: { command: 'curl -X POST https://api.example.com/hook -d x' },
      credentials: { command: 'ssh-keygen -t ed25519' },
      execute: { command: 'sudo systemctl restart nginx' },
    };
    const expected: Record<number, Record<keyof typeof calls, string>> = {
      0: {
        read: 'allow',
        write: 'needs-approval',
        deleteInside: 'needs-approval',
        deleteOutside: 'needs-approval',
        publish: 'needs-approval',
        send: 'needs-approval',
        credentials: 'needs-approval',
        execute: 'needs-approval',
      },
      1: {
        read: 'allow',
        write: 'allow',
        deleteInside: 'needs-approval',
        deleteOutside: 'needs-approval',
        publish: 'needs-approval',
        send: 'needs-approval',
        credentials: 'needs-approval',
        execute: 'needs-approval',
      },
      2: {
        read: 'allow',
        write: 'allow',
        deleteInside: 'allow',
        deleteOutside: 'needs-approval',
        publish: 'needs-approval',
        send: 'needs-approval',
        credentials: 'needs-approval',
        execute: 'needs-approval',
      },
      3: {
        read: 'allow',
        write: 'allow',
        deleteInside: 'allow',
        deleteOutside: 'needs-approval',
        publish: 'allow',
        send: 'allow',
        credentials: 'needs-approval',
        execute: 'allow',
      },
    };
    for (const level of [0, 1, 2, 3]) {
      await setLevel(s.asOwner, level);
      for (const [name, call] of Object.entries(calls)) {
        expect(`${level} ${name}: ${await outcome(s, run.id, call)}`).toBe(
          `${level} ${name}: ${expected[level]![name as keyof typeof calls]}`,
        );
      }
    }

    // Every decision but the plain reads is logged, with the level that applied.
    const logged = await db
      .select()
      .from(helenaPolicyDecision)
      .where(eq(helenaPolicyDecision.runId, run.id));
    expect(logged).toHaveLength(4 * 7);
    expect(logged.every((row) => row.adapter === 'hermes' && row.agentId === s.agent.id)).toBe(
      true,
    );
    const hardBlock = logged.find((row) => row.level === 3 && row.category === 'credentials')!;
    expect(hardBlock).toMatchObject({ outcome: 'needs-approval', reason: 'hard-block' });
    const page = await s.asOwner
      .projects({ projectKey: 'MKT' })
      .autopilot.decisions.get({ query: { outcome: 'needs-approval' } });
    expect(page.data!.total).toBe(logged.filter((row) => row.outcome === 'needs-approval').length);
    expect(page.data!.items[0]).toMatchObject({ agentName: 'Ext Bot', runId: run.id });
  });

  it('tells the agent how to ask for approval', async () => {
    const s = await setup();
    const { run } = await startRun(s);
    const res = await ask(s, run.id, { command: 'git push origin main' });
    expect(res.data).toMatchObject({
      outcome: 'needs-approval',
      category: 'publish',
      scope: 'external',
      level: 1,
      levelSource: 'project',
      reason: 'level-requires-approval',
    });
    expect(res.data!.message).toContain('request_approval');
    expect(res.data!.message).toContain('kind "publish"');
    expect(res.data!.message).toContain('exactly this command');
  });

  it('applies the stricter of the agent level and the project level, unless the owner raised it', async () => {
    const s = await setup();
    const agentAutopilot = s.asOwner.teams({ teamId: s.teamId })['ai-agents']({
      agentId: s.agent.id,
    }).autopilot;
    await setLevel(s.asOwner, 2);
    expect((await agentAutopilot.put({ level: 0 })).data!.projects[0]!.effective).toEqual({
      level: 0,
      source: 'agent',
    });
    expect((await agentAutopilot.put({ level: 3 })).data!.projects[0]!.effective).toEqual({
      level: 2,
      source: 'project',
    });
    const raised = (await agentAutopilot.put({ level: 3, raise: true })).data!;
    expect(raised.projects[0]!.effective).toEqual({ level: 3, source: 'agent-raised' });

    const { run } = await startRun(s);
    expect(
      (await s.asOwner.teams({ teamId: s.teamId })['ai-agents']({ agentId: s.agent.id }).runs.get())
        .data!.items[0],
    ).toMatchObject({ autopilotLevel: 3 });
    expect(await outcome(s, run.id, { command: 'git push origin main' })).toBe('allow');
    expect(run.autopilotLevel).toBe(3);
    expect(run.systemPrompt).toContain('Your Autopilot level in project MKT is 3');
  });

  it('refuses the agents themselves', async () => {
    const s = await setup();
    expect(
      (await s.asRunner.projects({ projectKey: 'MKT' }).autopilot.put({ level: 3 })).status,
    ).toBe(403);
    expect(
      (
        await s.asRunner
          .teams({ teamId: s.teamId })
          ['ai-agents']({ agentId: s.agent.id })
          .autopilot.put({ level: 3, raise: true })
      ).status,
    ).toBe(403);
  });

  it('lets exactly the command a person approved run in the follow-up run', async () => {
    const s = await setup();
    const { run } = await startRun(s);
    const request = await s.asRunner.projects({ projectKey: 'MKT' }).approvals.post({
      kind: 'publish',
      action: 'Push the landing page',
      command: 'git push origin main',
    });
    expect(request.data).toMatchObject({
      category: 'publish',
      autopilotLevel: 1,
      policyReason: 'level-requires-approval',
    });
    await s.asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'asked',
    });
    await s.asOwner.approvals({ approvalId: request.data!.id }).decision.post({ approved: true });
    const followUp = (await s.asRunner['agent-runs'].claim.post()).data!.run!;
    expect(followUp.trigger).toBe('approval');
    const approved = await ask(s, followUp.id, { command: 'git push origin main' });
    expect(approved.data).toMatchObject({ outcome: 'allow', reason: 'approved' });
    expect(await outcome(s, followUp.id, { command: 'git push origin dev' })).toBe(
      'needs-approval',
    );
  });

  it('lets an approved tool action without a command go ahead in the follow-up run', async () => {
    // PRIV-9, 2026-09-26: delete_issue was approved five times and stayed blocked, because
    // only approvals that name a command were matched.
    const s = await setup();
    const { run, issue } = await startRun(s);
    const request = await s.asRunner.projects({ projectKey: 'MKT' }).approvals.post({
      kind: 'delete',
      action: 'Delete MKT-1 for good',
    });
    expect(request.status).toBe(201);
    expect(request.data).toMatchObject({
      scope: 'workspace',
      policyReason: 'level-requires-approval',
    });
    await s.asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'asked',
    });
    await s.asOwner.approvals({ approvalId: request.data!.id }).decision.post({ approved: true });
    const followUp = (await s.asRunner['agent-runs'].claim.post()).data!.run!;
    const toolCall = (category: 'delete' | 'send') =>
      decide({
        adapter: 'mcp',
        agentId: s.agent.id,
        projectId: s.projectId,
        runId: followUp.id,
        category,
        scope: 'workspace',
        tool: category === 'delete' ? 'delete_issue' : 'send_mail',
        summary: category === 'delete' ? 'delete_issue {"issueId":' + issue.id + '}' : null,
      });
    expect(await toolCall('delete')).toMatchObject({ outcome: 'allow', reason: 'approved' });
    // The approval covers what it was asked for, not other kinds of action.
    expect((await toolCall('send')).outcome).toBe('needs-approval');
    expect(
      await actionApproved(
        s.agent.id,
        followUp.id,
        'delete',
        null,
        'delete_issue',
        'delete_issue {"issueId":999999}',
        s.projectId,
      ),
    ).toBe(false);
    // A different tool cannot reuse the issue deletion approval.
    expect(
      await actionApproved(
        s.agent.id,
        followUp.id,
        'delete',
        null,
        'delete_other',
        'delete_issue {"issueId":' + issue.id + '}',
        s.projectId,
      ),
    ).toBe(false);
    // And nothing outside the run the decision started.
    expect(await actionApproved(s.agent.id, run.id, 'delete', null)).toBe(false);
  });
});

describe('Autopilot on Helena’s own MCP tools', () => {
  beforeEach(resetDb);

  async function rpc(apiKey: string, method: string, params: Record<string, unknown> = {}) {
    const res = await app.handle(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
    const text = await res.text();
    return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
  }

  it('holds a write back at level 0 and lets the agent report', async () => {
    const s = await setup();
    const { issue } = await startRun(s);
    const { tools } = await rpc(s.agentKey, 'tools/list');
    const byName = new Map(tools.map((tool: { name: string }) => [tool.name, tool]));
    expect((byName.get('create_issue') as { _meta: Record<string, string> })._meta).toEqual({
      'helena/action': 'write',
    });
    expect((byName.get('add_comment') as { _meta: Record<string, string> })._meta).toEqual({
      'helena/action': 'report',
    });

    await setLevel(s.asOwner, 0);
    const blocked = await rpc(s.agentKey, 'tools/call', {
      name: 'create_issue',
      arguments: { projectKey: 'MKT', columnId: s.columnId, title: 'Sneaky' },
    });
    expect(blocked.isError).toBe(true);
    // The framework's MCP server asks its policy host, where the Autopilot is registered.
    expect(blocked.content[0].text).toContain(
      'This needs approval: Autopilot level 0 (Propose) asks a person before write',
    );
    const reported = await rpc(s.agentKey, 'tools/call', {
      name: 'add_comment',
      arguments: { issueId: issue.id, body: 'Proposal: add a pricing section.' },
    });
    expect(reported.isError).not.toBe(true);

    await setLevel(s.asOwner, 1);
    const created = await rpc(s.agentKey, 'tools/call', {
      name: 'create_issue',
      arguments: { projectKey: 'MKT', columnId: s.columnId, title: 'Allowed now' },
    });
    expect(created.isError).not.toBe(true);
    const log = await db
      .select()
      .from(helenaPolicyDecision)
      .where(eq(helenaPolicyDecision.adapter, 'mcp'));
    expect(log.map((row) => `${row.tool}:${row.outcome}`)).toEqual([
      'create_issue:needs-approval',
      'create_issue:allow',
    ]);
  });
});

describe('budgets', () => {
  beforeEach(resetDb);

  async function exhaustedBudget() {
    const s = await setup();
    const { run, issue } = await startRun(s);
    await budgets(s).put({ budgets: [{ metric: 'tokens', period: 'day', limit: 10 }] });
    await finish(s, run.id, 20, 0);
    const card = (await s.asOwner.approvals.get({ query: {} })).data!.items.find(
      (item) => item.kind === 'budget',
    )!;
    const [budget] = await budgetStatuses({ agentIds: [s.agent.id] });
    return { ...s, run, issue, card, budget: budget! };
  }

  it('reserves only one chat answer after continue once and permits its budgeted tools', async () => {
    const s = await exhaustedBudget();
    await s.asOwner.approvals({ approvalId: s.card.id }).budget.post({ action: 'once' });
    const sent = [];
    for (const prompt of ['First synthetic answer', 'Second synthetic answer']) {
      const reply = await s.asOwner
        .projects({ projectKey: 'MKT' })
        ['ai-agents']({ agentId: s.agent.id })
        .chat.post({ prompt });
      expect(reply.status).toBe(200);
      sent.push(reply.data!);
    }
    const first = (await s.asRunner['agent-chats'].claim.post()).data!.message!;
    expect(first.id).toBe(sent[0]!.messageId);
    const [budget] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(budget!.graceRuns).toBe(0);
    expect(budget!.graceRunIds).toEqual([-first.id]);
    const allowed = await decide({
      adapter: 'mcp',
      agentId: s.agent.id,
      projectId: s.projectId,
      chatMessageId: first.id,
      category: 'write',
      scope: 'workspace',
    });
    expect(allowed.outcome).toBe('allow');
    const other = await decide({
      adapter: 'mcp',
      agentId: s.agent.id,
      projectId: s.projectId,
      chatMessageId: sent[1]!.messageId,
      category: 'write',
      scope: 'workspace',
    });
    expect(other.reason).toBe('budget-exhausted');
    const second = (await s.asRunner['agent-chats'].claim.post()).data!.message;
    expect(second).toBeNull();
    await db
      .update(agentChatMessage)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(agentChatMessage.id, first.id));
    const resumed = (await s.asRunner['agent-chats'].claim.post()).data!.message;
    expect(resumed?.id).toBe(first.id);
    expect(resumed?.attempts).toBe(2);
    const [afterResume] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(afterResume!.graceRuns).toBe(0);
    expect(afterResume!.graceRunIds).toEqual([-first.id]);
    await db
      .update(aiAgent)
      .set({ pausedAt: new Date(), pauseReason: 'Owner maintenance' })
      .where(eq(aiAgent.id, s.agent.id));
    await db
      .update(agentChatMessage)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(agentChatMessage.id, first.id));
    expect((await s.asRunner['agent-chats'].claim.post()).data!.message).toBeNull();
  });

  it('reserves one grace run atomically across concurrent claims', async () => {
    const s = await exhaustedBudget();
    await continueOnce(s.budget.id);
    const results = await Promise.all([
      useGrace(s.agent.id, s.projectId, s.run.id + 1),
      useGrace(s.agent.id, s.projectId, s.run.id + 2),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [after] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(after!.graceRuns).toBe(0);
    expect(after!.graceRunIds).toHaveLength(1);
    expect(await useGrace(s.agent.id, s.projectId, after!.graceRunIds[0]!)).toBe(true);
  });

  it('does not let unconsumed grace bypass the hard stop for other work', async () => {
    const s = await exhaustedBudget();
    await continueOnce(s.budget.id);
    expect(await budgetExhausted(s.agent.id, s.projectId, s.run.id)).not.toBeNull();
    const reservations = await Promise.all(
      Array.from({ length: 24 }, (_, i) => useGrace(s.agent.id, s.projectId, s.run.id + 1 + i)),
    );
    expect(reservations.filter(Boolean)).toHaveLength(1);
    const [after] = await budgetStatuses({ agentIds: [s.agent.id] });
    const winner = after!.graceRunIds[0]!;
    expect(await budgetExhausted(s.agent.id, s.projectId, winner)).toBeNull();
    expect(await budgetExhausted(s.agent.id, s.projectId, s.run.id)).not.toBeNull();
    const stops = await Promise.all(
      Array.from({ length: 12 }, () => enforceBudgets(s.agent.id, s.projectId, s.issue.id)),
    );
    expect(stops.every((reason) => reason?.startsWith('Budget reached'))).toBe(true);
  });

  it('allows one independent task across agents sharing an exhausted project budget', async () => {
    const s = await setup();
    await s.asOwner.projects({ projectKey: 'MKT' }).autopilot.budgets.put({
      budgets: [{ metric: 'tokens', period: 'day', limit: 10 }],
    });
    const first = await startRun(s);
    await finish(s, first.run.id, 20, 0);
    const card = (await s.asOwner.approvals.get({ query: {} })).data!.items.find(
      (item) => item.kind === 'budget',
    )!;
    const other = (
      await createAgent(s.asOwner, 'MKT', {
        name: 'Other',
        username: 'other',
        kind: 'external',
      })
    ).data!;
    const otherRunner = apiKeyApi(other.apiKey!);
    for (let i = 0; i < 12; i++) {
      const task = (
        await s.asOwner.projects({ projectKey: 'MKT' }).issues.post({
          columnId: s.columnId,
          title: `Independent task ${i}`,
        })
      ).data!;
      await db.insert(agentRun).values({
        agentId: i % 2 ? other.agent.id : s.agent.id,
        projectId: s.projectId,
        issueId: task.id,
        prompt: 'Work',
      });
    }
    const stopped = await Promise.all([
      s.asRunner['agent-runs'].claim.post(),
      otherRunner['agent-runs'].claim.post(),
    ]);
    expect(stopped.every((result) => result.status === 200 && result.data!.run === null)).toBe(
      true,
    );
    expect(
      (await s.asOwner.approvals({ approvalId: card.id }).budget.post({ action: 'once' })).status,
    ).toBe(200);
    const claimed = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? otherRunner : s.asRunner)['agent-runs'].claim.post(),
      ),
    );
    expect(claimed.every((result) => result.status === 200)).toBe(true);
    expect(claimed.filter((result) => result.data!.run !== null)).toHaveLength(1);
    const [budget] = await budgetStatuses({ projectIds: [s.projectId] });
    expect(budget!.graceRuns).toBe(0);
    expect(budget!.graceRunIds).toHaveLength(1);
  });

  it('retries the owner card after its insert fails', async () => {
    const s = await exhaustedBudget();
    await db.delete(approvalRequest);
    await db
      .update(aiAgent)
      .set({ pausedAt: null, pauseReason: null })
      .where(eq(aiAgent.id, s.agent.id));
    await db.execute(sql`UPDATE helena_budget SET reached_for = NULL`);
    await db.execute(sql`CREATE FUNCTION test_budget_card_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Test card write failed'; END $$`);
    await db.execute(sql`CREATE TRIGGER test_budget_card_failure BEFORE INSERT ON approval_request
      FOR EACH ROW EXECUTE FUNCTION test_budget_card_failure()`);
    try {
      await expect(enforceBudgets(s.agent.id, s.projectId, s.issue.id)).rejects.toThrow();
      const [agent] = await db.select().from(aiAgent).where(eq(aiAgent.id, s.agent.id));
      expect(agent.pausedAt).toBeNull();
    } finally {
      await db.execute(sql`DROP TRIGGER test_budget_card_failure ON approval_request`);
      await db.execute(sql`DROP FUNCTION test_budget_card_failure()`);
    }
    expect(await enforceBudgets(s.agent.id, s.projectId, s.issue.id)).toContain('Budget reached');
    expect(await db.select().from(approvalRequest)).toHaveLength(1);
  });

  it('reserves grace idempotently when the same run is retried concurrently', async () => {
    const s = await exhaustedBudget();
    await continueOnce(s.budget.id);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => useGrace(s.agent.id, s.projectId, s.run.id + 1)),
    );
    expect(results.every(Boolean)).toBe(true);
    const [after] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(after!.graceRuns).toBe(0);
    expect(after!.graceRunIds).toEqual([s.run.id + 1]);
  });

  it('hands only one queued run to competing claim requests after continue once', async () => {
    const s = await exhaustedBudget();
    for (let i = 0; i < 2; i++) {
      await db.insert(agentRun).values({
        agentId: s.agent.id,
        projectId: s.projectId,
        issueId: s.issue.id,
        trigger: 'mention',
        prompt: `Work ${i}`,
      });
    }
    await s.asOwner.approvals({ approvalId: s.card.id }).budget.post({ action: 'once' });
    const claims = await Promise.all([
      s.asRunner['agent-runs'].claim.post(),
      s.asRunner['agent-runs'].claim.post(),
    ]);
    for (const claim of claims) expect(claim.status).toBe(200);
    expect(claims.filter((claim) => claim.data?.run)).toHaveLength(1);
  });

  it('keeps a card pending when writing its raised budget fails', async () => {
    const s = await exhaustedBudget();
    await db.execute(
      sql`CREATE FUNCTION helena_test_budget_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test budget write failed'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER helena_test_budget_failure BEFORE UPDATE OF limit_value ON helena_budget FOR EACH ROW EXECUTE FUNCTION helena_test_budget_failure()`,
    );
    try {
      const response = await s.asOwner
        .approvals({ approvalId: s.card.id })
        .budget.post({ action: 'raise', limit: 100 });
      expect(response.status).toBe(500);
      const [card] = await db
        .select()
        .from(approvalRequest)
        .where(eq(approvalRequest.id, s.card.id));
      expect(card!.status).toBe('pending');
    } finally {
      await db.execute(sql`DROP TRIGGER helena_test_budget_failure ON helena_budget`);
      await db.execute(sql`DROP FUNCTION helena_test_budget_failure()`);
    }
  });

  it('rolls back a budget raise when another decision wins the card', async () => {
    const s = await exhaustedBudget();
    const decisions = await Promise.all([
      s.asOwner.approvals({ approvalId: s.card.id }).budget.post({ action: 'raise', limit: 100 }),
      s.asOwner.approvals({ approvalId: s.card.id }).budget.post({ action: 'keep' }),
    ]);
    expect(decisions.map((decision) => decision.status).sort()).toEqual([200, 409]);
    const [card] = await db.select().from(approvalRequest).where(eq(approvalRequest.id, s.card.id));
    const [budget] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(budget!.limit).toBe(card!.status === 'approved' ? 100 : 10);
  });

  it('keeps project budget editors from changing team-wide agent budgets', async () => {
    const s = await exhaustedBudget();
    const editor = await signUpTestUser();
    const role = (
      await createRole(s.asOwner, 'MKT', {
        name: 'Budget editor',
        permissions: { ai_agents: { create: false, read: true, edit: true, delete: false } },
      })
    ).data!;
    await db.insert(teamMember).values({ teamId: s.teamId, userId: editor.userId, role: 'member' });
    await db
      .insert(projectMember)
      .values({ projectId: s.projectId, userId: editor.userId, role: 'member', roleId: role.id });
    const client = authedApi(editor.cookie);
    for (const action of ['raise', 'once'] as const) {
      expect(
        (await client.approvals({ approvalId: s.card.id }).budget.post({ action, limit: 100 }))
          .status,
      ).toBe(403);
    }
    const direct = client.teams({ teamId: s.teamId })['ai-agents']({ agentId: s.agent.id })
      .autopilot.budgets;
    expect(
      (await direct.put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] })).status,
    ).toBe(403);
    expect(
      (
        await client
          .teams({ teamId: s.teamId })
          .organization.agents({ agentId: s.agent.id })
          ['token-ceilings'].put({ daily: 100, monthly: null })
      ).status,
    ).toBe(403);
    expect(
      (
        await client
          .projects({ projectKey: 'MKT' })
          .autopilot.budgets.put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] })
      ).status,
    ).toBe(200);
    const [budget] = await budgetStatuses({ agentIds: [s.agent.id] });
    expect(budget!.limit).toBe(10);
    expect(budget!.graceRuns).toBe(0);
    await db
      .update(teamMember)
      .set({ role: 'manager' })
      .where(eq(teamMember.userId, editor.userId));
    expect(
      (await client.approvals({ approvalId: s.card.id }).budget.post({ action: 'once' })).status,
    ).toBe(200);
    expect(
      (await direct.put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] })).status,
    ).toBe(200);
  });

  it('preserves a warning for the next issue when chat work crosses 80 percent', async () => {
    const s = await setup();
    const { run, issue } = await startRun(s);
    await finish(s, run.id, 85, 0);
    await budgets(s).put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] });
    await enforceBudgets(s.agent.id, s.projectId, null);
    expect((await budgetStatuses({ agentIds: [s.agent.id] }))[0]!.warned).toBe(false);
    await enforceBudgets(s.agent.id, s.projectId, issue.id);
    expect(await comments(s.asOwner, issue.id)).toContainEqual(
      expect.stringContaining('Heads-up: 85 %'),
    );
  });

  it('refuses budget decisions over MCP when the project disables MCP', async () => {
    const s = await exhaustedBudget();
    await db.update(project).set({ mcpEnabled: false }).where(eq(project.id, s.projectId));
    const response = await app.handle(
      new Request(`http://localhost/approvals/${s.card.id}/budget`, {
        method: 'POST',
        headers: {
          cookie: s.owner.cookie,
          'content-type': 'application/json',
          'x-mcp-loopback': '1',
        },
        body: JSON.stringify({ action: 'once' }),
      }),
    );
    expect(response.status).toBe(403);
    const route = app.routes.find((route) => route.path === '/approvals/:approvalId/budget');
    expect(route?.hooks.detail?.['x-permission']).toEqual(['ai_agents', 'edit']);
  });

  function budgets(s: Setup) {
    return s.asOwner.teams({ teamId: s.teamId })['ai-agents']({ agentId: s.agent.id }).autopilot
      .budgets;
  }

  async function finish(s: Setup, runId: number, inputTokens: number, outputTokens: number) {
    await s.asRunner['agent-runs']({ runId }).result.post({
      status: 'success',
      output: 'Done',
      usage: { inputTokens, outputTokens },
    });
  }

  it('warns at 80 %, stops at 100 % with an owner card, and continues once or with more', async () => {
    const s = await setup();
    await budgets(s).put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] });

    const first = await startRun(s);
    await finish(s, first.run.id, 70, 15);
    expect(await comments(s.asOwner, first.issue.id)).toContainEqual(
      expect.stringContaining(
        'Heads-up: 85 % of my daily token budget is used (85 of 100 tokens).',
      ),
    );

    const second = await startRun(s, 'Pricing page');
    // A used-up budget denies everything but reading, approved or not.
    await finish(s, second.run.id, 20, 5);
    const view = (
      await s.asOwner
        .teams({ teamId: s.teamId })
        ['ai-agents']({ agentId: s.agent.id })
        .autopilot.get()
    ).data!;
    expect(view).toMatchObject({
      paused: true,
      pauseReason: 'Budget reached: daily token budget, 110 of 100 tokens used today (UTC).',
    });
    expect(view.budgets[0]).toMatchObject({ used: 110, remaining: 0, reached: true });

    const cards = (await s.asOwner.approvals.get({ query: {} })).data!.items;
    const card = cards.find((item) => item.kind === 'budget')!;
    expect(card).toMatchObject({
      status: 'pending',
      policyReason: 'budget-exhausted',
      payload: { metric: 'tokens', period: 'day', limit: 100, used: 110, scope: 'agent' },
    });
    // The generic decision does not apply to a budget card.
    expect(
      (await s.asOwner.approvals({ approvalId: card.id }).decision.post({ approved: true })).status,
    ).toBe(409);

    // "Einmalig fortsetzen": one more run starts past the limit.
    const once = await s.asOwner.approvals({ approvalId: card.id }).budget.post({ action: 'once' });
    expect(once.data).toMatchObject({ status: 'approved', note: 'once' });
    const third = await startRun(s, 'Docs page');
    expect(third.run).toBeTruthy();
    const denied = await ask(s, third.run.id, { tool: 'write_file', path: `${WS}/output.txt` });
    expect(denied.data).toMatchObject({ outcome: 'allow' });
    await finish(s, third.run.id, 10, 0);
    // Used up again: paused, and a new card.
    const again = (await s.asOwner.approvals.get({ query: {} })).data!.items.filter(
      (item) => item.kind === 'budget' && item.status === 'pending',
    );
    expect(again).toHaveLength(1);

    // "Budget erhöhen": a limit below what is used is refused; above it the agent works again.
    const budgetCard = s.asOwner.approvals({ approvalId: again[0]!.id }).budget;
    expect((await budgetCard.post({ action: 'raise', limit: 100 })).status).toBe(400);
    expect((await budgetCard.post({ action: 'raise', limit: 1_000 })).data).toMatchObject({
      status: 'approved',
      note: 'raised',
    });
    const after = (
      await s.asOwner
        .teams({ teamId: s.teamId })
        ['ai-agents']({ agentId: s.agent.id })
        .autopilot.get()
    ).data!;
    expect(after).toMatchObject({ paused: false });
    expect(after.budgets[0]).toMatchObject({ limit: 1_000, reached: false });
  });

  it('denies every action but reading while a budget is used up', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 3);
    const { run } = await startRun(s);
    await s.asOwner.projects({ projectKey: 'MKT' }).autopilot.budgets.put({
      budgets: [{ metric: 'tokens', period: 'month', limit: 10 }],
    });
    await finish(s, run.id, 20, 5);
    // The project's work is on hold: its next run is not handed out.
    expect((await startRun(s, 'Second')).run).toBeNull();
    // The run that is still going asks the engine: reads go on, the rest is denied.
    const res = await ask(s, run.id, { command: 'npm run build' });
    expect(res.data).toMatchObject({ outcome: 'deny', reason: 'budget-exhausted' });
    expect(await outcome(s, run.id, { command: 'cat README.md' })).toBe('allow');
    for (const command of [
      'awk \'BEGIN{system("git push")}\'',
      "sed -n '1e git push' input",
      '/usr/bin/env git push',
      'echo $(git push)',
      'echo `git push`',
      "bash -lc 'git push'",
      'env FOO=1 git push',
      'unknown-program > out.txt',
    ])
      expect(await outcome(s, run.id, { command })).toBe('deny');
  });

  it('counts euros from the price table and seconds of work', async () => {
    const s = await setup();
    await db.update(aiAgent).set({ model: 'claude-opus-5' }).where(eq(aiAgent.id, s.agent.id));
    await budgets(s).put({
      budgets: [
        { metric: 'cost', period: 'month', limit: 100 },
        { metric: 'time', period: 'day', limit: 3600 },
      ],
    });
    const { run } = await startRun(s);
    await finish(s, run.id, 1_000_000, 100_000);
    const view = (
      await s.asOwner
        .teams({ teamId: s.teamId })
        ['ai-agents']({ agentId: s.agent.id })
        .autopilot.get()
    ).data!;
    const cost = view.budgets.find((budget) => budget.metric === 'cost')!;
    // claude-opus-5 at models.dev's $5 / $25 per 1M tokens, at 0.86 € per $.
    expect(cost.used).toBeCloseTo((5 + 2.5) * 0.86, 4);
    expect(view.usage.month.cost).toBeCloseTo((5 + 2.5) * 0.86, 4);
    expect(view.budgets.find((budget) => budget.metric === 'time')!.used).toBeGreaterThanOrEqual(0);
  });
});

describe('Autopilot report', () => {
  beforeEach(resetDb);

  it('lists on the task what a level-2 agent did without approval', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 2);
    const { issue, run } = await startRun(s);
    expect(await outcome(s, run.id, { command: 'rm -rf build' })).toBe('allow');
    expect(await outcome(s, run.id, { tool: 'write_file', command: undefined, path: 'a.md' })).toBe(
      'allow',
    );
    await s.asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'ok',
    });
    const report = (await comments(s.asOwner, issue.id)).find((body) =>
      body?.startsWith('Autopilot report'),
    )!;
    expect(report).toContain('level 2 (Act & report)');
    expect(report).toContain('- delete: `rm -rf build`');
    expect(report).not.toContain('a.md');
  });
});

describe('adapters for the workflow engine and the browser gateway', () => {
  beforeEach(resetDb);

  it('answers the workflow engine’s policy seam', async () => {
    const s = await setup();
    const ask = (actionCategory: string) =>
      autopilotPolicyDecider.decide({
        agentId: s.agent.id,
        projectId: s.projectId,
        actionCategory,
        subject: 'step',
      });
    expect((await ask('approve')).decision).toBe('ask');
    expect((await ask('run')).decision).toBe('allow');
    expect((await ask('write')).decision).toBe('allow');
    expect((await ask('send')).decision).toBe('ask');
    expect((await ask('webhook')).decision).toBe('ask');
    await setLevel(s.asOwner, 3);
    expect((await ask('send')).decision).toBe('allow');
    expect((await ask('pay')).decision).toBe('ask');
    await s.asOwner
      .teams({ teamId: s.teamId })
      .organization.agents({ agentId: s.agent.id })
      .pause.post({ reason: 'Budget review' });
    expect(await ask('run')).toEqual({ decision: 'deny', reason: 'Budget review' });
  });

  it('decides the browser gateway’s tools, with a declared intent', async () => {
    const s = await setup();
    const tool = (name: string, intent?: 'pay' | 'send') =>
      decideBrowserTool({
        agent: { id: s.agent.id, teamId: s.teamId },
        projectId: s.projectId,
        tool: name,
        intent,
        target: 'https://shop.example.com',
      });
    await setLevel(s.asOwner, 0);
    expect((await tool('browser_snapshot')).outcome).toBe('allow');
    expect((await tool('browser_click')).outcome).toBe('needs-approval');
    await setLevel(s.asOwner, 3);
    expect((await tool('browser_click')).outcome).toBe('allow');
    expect(await tool('browser_click', 'pay')).toMatchObject({
      outcome: 'needs-approval',
      category: 'pay',
      reason: 'hard-block',
    });
  });
});

describe('the Autopilot as an @helena/sdk policy evaluator', () => {
  beforeEach(resetDb);

  it('ignores an agent-supplied input scope for external deletes', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 3);
    const request = {
      agent: { id: s.agent.id },
      project: { id: s.projectId, key: 'MKT', teamId: s.teamId },
      action: 'delete' as const,
      context: { tool: 'delete_resource', input: { scope: 'workspace' } },
    };
    expect(await autopilotPolicyEvaluator.evaluate(request)).toMatchObject({
      effect: 'needs-approval',
    });
    expect(
      await autopilotPolicyEvaluator.evaluate({
        ...request,
        context: { ...request.context, scope: 'workspace' },
      }),
    ).toMatchObject({ effect: 'allow' });
  });

  it('answers for agents in the SDK shape and abstains for people and other questions', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 3);
    const ask = (action: string, agent: { id: number } | null = { id: s.agent.id }) =>
      autopilotPolicyEvaluator.evaluate({
        agent,
        project: { id: s.projectId, key: 'MKT', teamId: s.teamId },
        action: action as ActionCategory,
        context: { connector: 'notion', service: 'pages', target: 'Roadmap page' },
      });
    expect(await ask('send')).toEqual({
      effect: 'allow',
      reason: 'Autopilot level 3 (Autonomous within budget) allows send',
      evaluator: 'helena-autopilot',
    });
    expect(await ask('delete')).toMatchObject({
      effect: 'needs-approval',
      reason: 'A person always approves delete, even at level 3',
    });
    expect(await ask('send', null)).toBeNull();
    expect(await ask('launch')).toBeNull();
    const logged = await db
      .select()
      .from(helenaPolicyDecision)
      .where(eq(helenaPolicyDecision.adapter, 'connector'))
      .orderBy(helenaPolicyDecision.id);
    // A connector's delete reaches outside the agent's workspace.
    expect(logged.map((row) => `${row.category}:${row.scope}:${row.outcome}`)).toEqual([
      'send:workspace:allow',
      'delete:external:needs-approval',
    ]);
    expect(logged[0]).toMatchObject({ tool: 'pages', summary: 'Roadmap page' });
  });
});

describe('shell hard blocks at level 3', () => {
  beforeEach(resetDb);
  it('preserves external-delete and credential blocks through shell wrappers', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 3);
    const { run } = await startRun(s);
    for (const command of [
      'rm -rf ${HOME}',
      'cd && rm -rf *',
      'cd - && rm -rf *',
      'rm -rf /tmp/../home/user',
      "bash -c 'rm -rf ~'",
      '\\rm /etc/file',
      'nice -n 10 rm /etc/file',
      'env FOO=1 command rm /etc/file',
      'xargs -I {} rm {}',
      'find . -exec echo {} + -exec rm ~ +',
      "xargs bash -c 'gh auth login'",
    ])
      expect(await outcome(s, run.id, { command })).toBe('needs-approval');
  });
});

describe('Autopilot numeric route parameters', () => {
  beforeEach(resetDb);
  it('rejects malformed ids before database access', async () => {
    const s = await setup();
    for (const [method, path, body] of [
      ['GET', `/teams/${s.teamId}/ai-agents/not-a-number/autopilot`, undefined],
      ['PUT', `/teams/${s.teamId}/ai-agents/not-a-number/autopilot`, { level: 3 }],
      ['PUT', `/teams/${s.teamId}/ai-agents/not-a-number/autopilot/budgets`, { budgets: [] }],
      ['POST', '/approvals/not-a-number/budget', { action: 'once' }],
    ] as const) {
      const response = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { cookie: s.owner.cookie, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
      expect(response.status).toBe(400);
    }
  });
});
