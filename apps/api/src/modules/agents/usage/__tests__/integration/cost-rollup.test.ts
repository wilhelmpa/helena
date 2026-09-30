import { beforeEach, describe, expect, it } from 'bun:test';
import {
  agentRun,
  approvalRequest,
  db,
  helenaGoalTask,
  helenaProjectGoalLink,
  initiative,
  notification,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import {
  budgetExhausted,
  budgetStatuses,
  enforceBudgets,
  heartbeatBudgetThrottled,
  setBudgets,
} from '#modules/autopilot/budgets';
import { setManualPrice } from '#modules/model-prices/service';
import { recordUsage } from '../../service';

describe('agent cost rollup and department throttle', () => {
  beforeEach(resetDb);

  it('attributes a task under a linked initiative to its organization goal', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const project = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
    const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
    const agent = (
      await createAgent(asOwner, 'MKT', { name: 'Worker', username: 'worker', kind: 'external' })
    ).data!.agent;
    const [goal] = await db
      .insert(organizationGoal)
      .values({
        teamId: project.teamId,
        projectId: project.id,
        title: 'Launch',
      })
      .returning();
    const [plan] = await db
      .insert(initiative)
      .values({ projectId: project.id, title: 'Campaign' })
      .returning();
    await db.insert(helenaProjectGoalLink).values({ initiativeId: plan!.id, goalId: goal!.id });
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({
        title: 'Draft copy',
        columnId: view.columns[0]!.id,
        initiativeId: plan!.id,
      })
    ).data!;
    const [run] = await db
      .insert(agentRun)
      .values({
        agentId: agent.id,
        projectId: project.id,
        issueId: task.id,
        prompt: 'Draft',
      })
      .returning();
    await recordUsage({
      agentId: agent.id,
      projectId: project.id,
      runId: run!.id,
      kind: 'run',
      spend: { model: 'test-model', inputTokens: 12, outputTokens: 3 },
    });
    const usage = await asOwner.teams({ teamId: project.teamId })['agent-usage'].get({
      query: { by: 'issue,goal' },
    });
    expect(usage.status).toBe(200);
    expect(usage.data?.rows[0]).toMatchObject({
      issueId: task.id,
      goalId: goal!.id,
      inputTokens: 12,
    });
    await db.delete(helenaProjectGoalLink);
    const fallback = await asOwner.teams({ teamId: project.teamId })['agent-usage'].get({
      query: { by: 'issue,goal' },
    });
    expect(fallback.data?.rows[0]?.goalId).toBe(goal!.id);
  });

  it('attributes every runtime to its task, agent, project, goal and department and files a budget card', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    expect((await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).status).toBe(201);
    const project = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
    const projectId = project.project.id;
    const teamId = project.project.teamId;
    const agent = (
      await createAgent(asOwner, 'MKT', {
        name: 'Worker',
        username: 'worker',
        kind: 'external',
      })
    ).data!.agent;
    const issue = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({
        title: 'Make plan',
        columnId: project.columns[0]!.id,
      })
    ).data!;
    const [department] = await db
      .insert(organizationDepartment)
      .values({ teamId, name: 'Volition' })
      .returning();
    const [goal] = await db
      .insert(organizationGoal)
      .values({ teamId, departmentId: department!.id, projectId, title: 'Grow' })
      .returning();
    await db.insert(organizationProjectAssignment).values({
      teamId,
      projectId,
      departmentId: department!.id,
    });
    await db.insert(organizationAgentAssignment).values({
      teamId,
      agentId: agent.id,
      departmentId: department!.id,
    });
    await db.insert(helenaGoalTask).values({
      teamId,
      issueId: issue.id,
      goalId: goal!.id,
      linkedByUserId: owner.userId,
    });
    for (const runtime of ['hermes', 'claude', 'codex']) {
      const [run] = await db
        .insert(agentRun)
        .values({ agentId: agent.id, projectId, issueId: issue.id, prompt: runtime })
        .returning({ id: agentRun.id });
      await recordUsage({
        agentId: agent.id,
        projectId,
        runId: run!.id,
        kind: 'run',
        spend: { runtime, model: 'unknown-test-model', inputTokens: 30, outputTokens: 10 },
      });
    }
    await db.insert(agentRun).values({
      agentId: agent.id,
      projectId,
      issueId: issue.id,
      prompt: 'older run without ledger',
      status: 'success',
      model: 'unknown-test-model',
      inputTokens: 5,
      outputTokens: 5,
      finishedAt: new Date(),
    });
    const usage = await asOwner.teams({ teamId })['agent-usage'].get({
      query: { by: 'issue,agent,project,goal,department' },
    });
    expect(usage.status).toBe(200);
    expect(usage.data?.rows).toHaveLength(1);
    expect(usage.data?.rows[0]).toMatchObject({
      issueId: issue.id,
      agentId: agent.id,
      projectId,
      goalId: goal!.id,
      departmentId: department!.id,
      inputTokens: 95,
      outputTokens: 35,
      entries: 4,
      unledgeredRuns: 1,
      costEur: null,
    });
    expect(usage.data?.unpriced).toBe(true);
    expect(usage.data?.total.costEur).toBeNull();

    await setBudgets(
      teamId,
      { departmentId: department!.id },
      [{ metric: 'tokens', period: 'day', limit: 100 }],
      owner.userId,
    );
    const budgets = await asOwner
      .teams({ teamId })
      .organization.departments({ departmentId: department!.id })
      .budgets.get();
    expect(budgets.status).toBe(200);
    expect(budgets.data?.[0]).toMatchObject({ used: 130, reached: true, scope: 'department' });
    expect(await enforceBudgets(agent.id, projectId, issue.id)).toContain('Budget reached');
    const cards = await db.select().from(approvalRequest).where(eq(approvalRequest.kind, 'budget'));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ projectId, agentId: agent.id, status: 'pending' });
    expect(
      await db.select().from(notification).where(eq(notification.type, 'approval_requested')),
    ).toMatchObject([{ userId: owner.userId, issueId: issue.id }]);
    const organization = await asOwner.teams({ teamId }).organization.get({ query: {} });
    expect(organization.data?.agents.find((entry) => entry.id === agent.id)?.throttled).toBe(true);
    const continued = await asOwner.approvals({ approvalId: cards[0]!.id }).budget.post({
      action: 'once',
    });
    expect(continued.status).toBe(200);
    expect(await enforceBudgets(agent.id, projectId, issue.id)).toBeNull();

    await recordUsage({
      agentId: agent.id,
      projectId: null,
      kind: 'chat',
      spend: { runtime: 'claude', inputTokens: 1, outputTokens: 1, durationMs: 2_000 },
    });
    await setBudgets(
      teamId,
      { departmentId: department!.id },
      [{ metric: 'time', period: 'day', limit: 1 }],
      owner.userId,
    );
    expect(await enforceBudgets(agent.id, null, null)).toContain('Budget reached');
    expect(
      (await db.select().from(approvalRequest).where(eq(approvalRequest.kind, 'budget'))).length,
    ).toBe(2);
  });

  it('sums local and cloud work through parent goals and stops every exhausted budget scope', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    const created = (await asOwner.projects.post({ key: 'SUM', name: 'Sums' })).data!;
    const view = (await asOwner.projects({ projectKey: 'SUM' }).get()).data!;
    const agent = (
      await createAgent(asOwner, 'SUM', { name: 'Worker', username: 'worker', kind: 'external' })
    ).data!.agent;
    const task = (
      await asOwner.projects({ projectKey: 'SUM' }).issues.post({
        title: 'Ship',
        columnId: view.columns[0]!.id,
      })
    ).data!;
    const [department] = await db
      .insert(organizationDepartment)
      .values({ teamId: created.teamId, name: 'Build' })
      .returning();
    const [parent] = await db
      .insert(organizationGoal)
      .values({ teamId: created.teamId, title: 'Grow' })
      .returning();
    const [goal] = await db
      .insert(organizationGoal)
      .values({
        teamId: created.teamId,
        projectId: created.id,
        departmentId: department!.id,
        parentGoalId: parent!.id,
        title: 'Ship',
      })
      .returning();
    await db
      .insert(organizationProjectAssignment)
      .values({ teamId: created.teamId, projectId: created.id, departmentId: department!.id });
    await db.insert(helenaGoalTask).values({
      teamId: created.teamId,
      issueId: task.id,
      goalId: goal!.id,
      linkedByUserId: owner.userId,
    });
    await setManualPrice(
      'codex139-cloud',
      { provider: 'openai', inputPerMTok: 1000, outputPerMTok: 1000 },
      owner.userId,
    );
    const [run] = await db
      .insert(agentRun)
      .values({ agentId: agent.id, projectId: created.id, issueId: task.id, prompt: 'Ship' })
      .returning();
    await recordUsage({
      agentId: agent.id,
      projectId: created.id,
      runId: run!.id,
      kind: 'run',
      spend: {
        runtime: 'helena',
        model: 'helena-test/local',
        provider: 'helena-test',
        inputTokens: 100,
        outputTokens: 0,
        durationMs: 1000,
      },
    });
    await recordUsage({
      agentId: agent.id,
      projectId: created.id,
      runId: run!.id,
      kind: 'run',
      spend: {
        runtime: 'helena',
        model: 'codex139-cloud',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 0,
        durationMs: 2000,
      },
    });
    await recordUsage({
      agentId: agent.id,
      projectId: created.id,
      kind: 'chat',
      spend: {
        runtime: 'helena',
        model: 'helena-test/local',
        provider: 'helena-test',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 3000,
      },
    });

    const summary = await asOwner
      .teams({ teamId: created.teamId })
      ['budget-summary'].get({ query: { period: 'week' } });
    expect(summary.status).toBe(200);
    expect(summary.data?.usage.total).toMatchObject({
      inputTokens: 200,
      durationMs: 6000,
      entries: 3,
      costEur: 0.1,
    });
    expect(summary.data?.usage.unpriced).toBe(false);
    expect(summary.data?.usage.rows.find((row) => row.issueId === task.id)).toMatchObject({
      goalId: goal!.id,
      departmentId: department!.id,
      costEur: 0.1,
    });

    const taskBudget = await asOwner.issues({ issueId: task.id }).autopilot.budgets.put({
      budgets: [{ metric: 'tokens', period: 'week', limit: 240 }],
    });
    expect(taskBudget.status).toBe(200);
    expect(taskBudget.data?.[0]).toMatchObject({ used: 200, throttled: true, scope: 'issue' });

    await setBudgets(
      created.teamId,
      { goalId: parent!.id },
      [{ metric: 'tokens', period: 'week', limit: 240 }],
      owner.userId,
    );
    expect((await budgetStatuses({ goalIds: [parent!.id] }))[0]).toMatchObject({
      used: 200,
      reached: false,
      throttled: true,
    });
    expect(await heartbeatBudgetThrottled(agent.id, created.id, task.id)).toBe(true);
    expect(await enforceBudgets(agent.id, created.id, task.id)).toBeNull();

    await setBudgets(
      created.teamId,
      { agentId: agent.id },
      [{ metric: 'tokens', period: 'day', limit: 150 }],
      owner.userId,
    );
    await setBudgets(
      created.teamId,
      { issueId: task.id },
      [{ metric: 'cost', period: 'day', limit: 0.05 }],
      owner.userId,
    );
    await setBudgets(
      created.teamId,
      { projectId: created.id },
      [{ metric: 'cost', period: 'week', limit: 0.05 }],
      owner.userId,
    );
    await setBudgets(
      created.teamId,
      { goalId: goal!.id },
      [{ metric: 'tokens', period: 'month', limit: 150 }],
      owner.userId,
    );
    const goalBudget = await asOwner
      .teams({ teamId: created.teamId })
      .organization.goals({ goalId: parent!.id })
      .budgets.put({ budgets: [{ metric: 'cost', period: 'week', limit: 0.05 }] });
    expect(goalBudget.status).toBe(200);
    expect(goalBudget.data?.find((budget) => budget.metric === 'cost')).toMatchObject({
      used: 0.1,
      reached: true,
      scope: 'goal',
    });
    await setBudgets(
      created.teamId,
      { departmentId: department!.id },
      [{ metric: 'time', period: 'month', limit: 5 }],
      owner.userId,
    );
    await db
      .update(organizationGoal)
      .set({ status: 'achieved' })
      .where(eq(organizationGoal.id, goal!.id));
    expect(await enforceBudgets(agent.id, created.id, task.id)).toContain('Budget reached');
    expect(await budgetExhausted(agent.id, created.id, run!.id)).not.toBeNull();
    const cards = await db.select().from(approvalRequest).where(eq(approvalRequest.kind, 'budget'));
    expect(cards).toHaveLength(6);
    expect(new Set(cards.map((card) => (card.payload as { scope: string }).scope))).toEqual(
      new Set(['issue', 'agent', 'project', 'goal', 'department']),
    );
    const taskCard = cards.find((card) => (card.payload as { scope: string }).scope === 'issue')!;
    expect(
      (
        await asOwner
          .approvals({ approvalId: taskCard.id })
          .budget.post({ action: 'raise', limit: 1 })
      ).status,
    ).toBe(200);
    expect(
      (await asOwner.issues({ issueId: task.id }).autopilot.budgets.get()).data?.find(
        (budget) => budget.metric === 'cost',
      ),
    ).toMatchObject({ reached: false, used: 0.1 });
  });
});
