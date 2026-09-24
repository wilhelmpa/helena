import { beforeEach, describe, expect, it } from 'bun:test';
import { db, aiAgent, helenaPolicyDecision } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { autopilotPolicyDecider, decideBrowserTool } from '#modules/autopilot/adapters';
import { autopilotPolicyEvaluator } from '#modules/autopilot/evaluator';

// Helena's Autopilot: one level per project (with an optional per-agent level), one policy
// engine every runtime asks, budgets that stop the work cleanly, and a log entry for each
// decision.

const WS = '/srv/work/mkt';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
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

  it('starts every project at level 1 and says what each level allows', async () => {
    const { asOwner } = await setup();
    const view = (await asOwner.projects({ projectKey: 'MKT' }).autopilot.get()).data!;
    expect(view.level).toBe(1);
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
    expect(blocked.content[0].text).toContain("Helena's Autopilot");
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
    const denied = await ask(s, third.run.id, { command: 'npm run build' });
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

  it('answers for agents in the SDK shape and abstains for people and other questions', async () => {
    const s = await setup();
    await setLevel(s.asOwner, 3);
    const ask = (action: string, agent: { id: number } | null = { id: s.agent.id }) =>
      autopilotPolicyEvaluator.evaluate({
        agent,
        project: { id: s.projectId, key: 'MKT', teamId: s.teamId },
        action,
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
    const [logged] = await db
      .select()
      .from(helenaPolicyDecision)
      .where(eq(helenaPolicyDecision.adapter, 'connector'));
    expect(logged).toMatchObject({ tool: 'pages', summary: 'Roadmap page', scope: 'external' });
  });
});
