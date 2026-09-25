import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { agentRun, aiAgent, db, helenaSchedule, issueWatcher, notification } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import {
  runSteps,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForStatus,
} from '#tests/helpers/engine';
import { createRole } from '#tests/helpers/roles';
import { planFire } from '#modules/engine/schedules';

// A routine's @mentions of agents start them on the routine's task, as the mentions of the
// member it acts for, with every guard of a comment's mentions; and a routine's work keeps
// quiet: its task subscribes nobody, and what its agents write there reaches a person only
// once a day per routine, unless they ask for an answer (docs/helena-decisions/
// routine-mentions.md).

setDefaultTimeout(30_000);

interface Agent {
  id: number;
  userId: string;
  username: string;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const agent = async (name: string, username: string, body: Record<string, unknown> = {}) => {
    const res = await createAgent(asOwner, 'MKT', {
      name,
      username,
      triggerOnMention: true,
      delegationDelaySec: 0,
      ...body,
    } as never);
    return { ...(res.data!.agent as Agent), runner: apiKeyApi(res.data!.apiKey!) };
  };
  const writer = await agent('Writer', 'writer', { triggerOnAssign: true });
  const coder = await agent('Coder', 'coder');
  const seo = await agent('Content SEO', 'seo');
  const columns = view.columns;
  return {
    owner,
    asOwner,
    writer,
    coder,
    seo,
    agent,
    teamId: created.data!.teamId,
    column: (name: string) => columns.find((column) => column.name === name)!.id,
  };
}

const routines = (client: Api) => client.projects({ projectKey: 'MKT' }).routines;

function routineBody(agentId: number, instructions: string, body: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    agentId,
    title: 'Weekly check',
    instructions,
    mode: 'new' as const,
    cron: '0 9 * * 1',
    ...body,
  };
}

const INSTRUCTIONS =
  'Montags: @coder prüf die Abhängigkeiten, @seo fasse zusammen. @writer schreibt den Bericht.';

// The parts of a fire's dispatch step, one per mentioned agent, by agent.
async function mentionParts(runId: string) {
  return (await runSteps(runId))
    .filter((step) => step.stepId.startsWith('dispatch.'))
    .sort((a, b) => a.agentId! - b.agentId!);
}

async function runsOn(issueId: number) {
  return db.select().from(agentRun).where(eq(agentRun.issueId, issueId)).orderBy(asc(agentRun.id));
}

// A member of the project with the agent permissions, by id and handle.
async function agentAdmin(asOwner: Api) {
  const user = await signUpTestUser({ name: 'Member' });
  const role = await createRole(asOwner, 'MKT', {
    name: 'Agent admin',
    permissions: {
      ai_agents: { read: true, create: true, edit: true, delete: true },
      work_items: { read: true, create: true, edit: true, delete: true },
    },
  });
  const invite = await asOwner
    .projects({ projectKey: 'MKT' })
    .invites.post({ email: user.email, role: 'member', roleId: role.data!.id });
  const api = authedApi(user.cookie);
  await api.invites({ token: invite.data!.token }).accept.post();
  return { ...user, api };
}

async function mentionsOf(userId: string) {
  return db
    .select({ type: notification.type, issueId: notification.issueId })
    .from(notification)
    .where(eq(notification.userId, userId))
    .orderBy(asc(notification.id));
}

// Fires the routine at a time the way the engine's tick does, acting for the member it
// was saved by, whoever that is now.
async function fire(scheduleId: string, at: Date) {
  const runId = await planFire(scheduleId, at.toISOString(), at.getTime());
  const { startRun } = await import('#modules/engine/runs');
  await startRun(runId!);
  return waitForStatus(runId!, 'succeeded', 'skipped', 'failed');
}

beforeAll(async () => {
  await startEngine();
});

afterAll(async () => {
  await stopTestEngine();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await stopEngineRuns();
});

describe('routine mentions', () => {
  it('starts the two agents the instructions mention, next to its own agent', async () => {
    const { asOwner, writer, coder, seo } = await setup();
    const created = await routines(asOwner).post(routineBody(writer.id, INSTRUCTIONS));
    expect(created.status).toBe(201);
    // The routine's own agent gets the task; only the others are its mentions.
    expect(created.data!.mentions).toEqual([
      { agent: { id: coder.id, name: 'Coder', username: 'coder' }, starts: true, reason: null },
      { agent: { id: seo.id, name: 'Content SEO', username: 'seo' }, starts: true, reason: null },
    ]);

    const run = (await routines(asOwner)({ routineId: created.data!.id }).run.post()).data!;
    const fired = await waitForStatus(run.runId, 'succeeded');
    const runs = await runsOn(fired.issueId!);
    expect(runs.map((row) => [row.agentId, row.trigger, row.sourceActivityId])).toEqual([
      [coder.id, 'mention', null],
      [seo.id, 'mention', null],
      [writer.id, 'delegation', null],
    ]);
    expect(runs[0]!.prompt).toBe(INSTRUCTIONS);

    // The fire's history names each agent it started and the run.
    expect(
      (await mentionParts(fired.id)).map((step) => [
        step.stepId,
        step.status,
        step.outcome,
        step.agentId,
        step.agentRunId,
      ]),
    ).toEqual([
      [`dispatch.m${coder.id}`, 'succeeded', 'mention-started', coder.id, runs[0]!.id],
      [`dispatch.m${seo.id}`, 'succeeded', 'mention-started', seo.id, runs[1]!.id],
    ]);
    const history = (
      await routines(asOwner)({ routineId: created.data!.id }).runs.get({ query: {} })
    ).data!;
    expect(history.items[0]!.steps.map((step) => step.parentStepId)).toEqual([
      null,
      'dispatch',
      'dispatch',
    ]);

    // Each agent learns it works on a routine's task, beside whom, and to tag nobody.
    const mention = (await coder.runner['agent-runs'].claim.post()).data!.run!;
    expect(mention.prompt).toContain('The routine "Weekly check" of your project names you');
    expect(mention.prompt).toContain(
      'Working on it besides you: @writer, to whom the issue is delegated; @seo.',
    );
    expect(mention.prompt).toContain('tag nobody in your comments');
    expect(mention.prompt).toContain(INSTRUCTIONS);
    expect(mention.systemPrompt).not.toContain('To mention a person in a comment');
    const delegation = (await writer.runner['agent-runs'].claim.post()).data!.run!;
    expect(delegation.prompt).toContain('comes from the routine "Weekly check"');
    expect(delegation.prompt).toContain('The routine also started @coder, @seo on this issue');
    expect(delegation.prompt).toContain('tag nobody in your comments');
    expect(delegation.prompt).not.toContain('tag a project owner');
  });

  it('refuses a mention of an agent that takes work from its owner only, at save and when it fires', async () => {
    const { asOwner, writer, coder, seo, teamId } = await setup();
    const member = await agentAdmin(asOwner);
    const agents = asOwner.teams({ teamId })['ai-agents'];
    await agents({ agentId: coder.id }).patch({ runnerScope: 'owner' });
    // The member may not hand the owner's agent work through a routine.
    const refused = await routines(member.api).post(routineBody(writer.id, INSTRUCTIONS));
    expect(refused.status).toBe(403);
    expect(await db.select().from(helenaSchedule)).toHaveLength(0);
    const preview = await routines(member.api).mentions.post({
      instructions: INSTRUCTIONS,
      agentId: writer.id,
    });
    expect(preview.data!.map((item) => [item.agent.username, item.starts, item.reason])).toEqual([
      ['coder', false, 'owner-only'],
      ['seo', true, null],
    ]);

    // Saved while it could, then the owner keeps the agent to himself: the fire reports it.
    await agents({ agentId: coder.id }).patch({ runnerScope: 'team' });
    const saved = (await routines(member.api).post(routineBody(writer.id, INSTRUCTIONS))).data!;
    await agents({ agentId: coder.id }).patch({ runnerScope: 'owner' });
    expect((await routines(member.api)({ routineId: saved.id }).run.post()).status).toBe(403);
    const listed = (await routines(asOwner).get({ query: {} })).data!.items[0]!;
    expect(listed.mentions.map((item) => [item.agent.username, item.reason])).toEqual([
      ['coder', 'owner-only'],
      ['seo', null],
    ]);
    const fired = await fire(saved.id, new Date('2026-09-21T07:00:00.000Z'));
    expect(fired.status).toBe('succeeded');
    const runs = await runsOn(fired.issueId!);
    expect(runs.map((row) => row.agentId)).toEqual([seo.id, writer.id]);
    const parts = await mentionParts(fired.id);
    expect(parts.map((step) => [step.agentId, step.status, step.outcome, step.agentRunId])).toEqual(
      [
        [coder.id, 'skipped', 'mention-owner-only', null],
        [seo.id, 'succeeded', 'mention-started', runs[0]!.id],
      ],
    );
  });

  it('reports a paused agent and one that does not react to mentions, and starts neither', async () => {
    const { asOwner, writer, coder, seo, agent } = await setup();
    const quiet = await agent('Quiet', 'quiet', { triggerOnMention: false });
    await db.update(aiAgent).set({ pausedAt: new Date() }).where(eq(aiAgent.id, coder.id));
    const created = (
      await routines(asOwner).post(
        routineBody(writer.id, `${INSTRUCTIONS} @quiet hilft. @nobody liest mit.`),
      )
    ).data!;
    expect(created.mentions.map((item) => [item.agent.username, item.reason])).toEqual([
      ['coder', 'paused'],
      ['seo', null],
      ['quiet', 'mentions-off'],
    ]);
    const run = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const fired = await waitForStatus(run.runId, 'succeeded');
    expect((await runsOn(fired.issueId!)).map((row) => row.agentId)).toEqual([seo.id, writer.id]);
    const outcomes = (await mentionParts(fired.id)).map((step) => [step.agentId, step.outcome]);
    expect(outcomes).toEqual([
      [coder.id, 'mention-paused'],
      [seo.id, 'mention-started'],
      [quiet.id, 'mention-mentions-off'],
    ]);
  });

  it('starts nobody by the mentions of a routine an agent saved, nor by an agent’s comment', async () => {
    const { asOwner, writer, coder, seo } = await setup();
    const created = (await routines(asOwner).post(routineBody(writer.id, INSTRUCTIONS))).data!;
    // A routine an agent saved acts for the agent: its mentions are an agent's.
    await db
      .update(helenaSchedule)
      .set({ actorUserId: writer.userId })
      .where(eq(helenaSchedule.id, created.id));
    const fired = await fire(created.id, new Date('2026-09-21T07:00:00.000Z'));
    expect(fired.status).toBe('succeeded');
    expect((await runsOn(fired.issueId!)).map((row) => row.agentId)).toEqual([]);
    expect((await mentionParts(fired.id)).map((step) => [step.agentId, step.outcome])).toEqual([
      [coder.id, 'mention-agent-author'],
      [seo.id, 'mention-agent-author'],
    ]);

    // An agent tagging another in a comment on the routine's task starts no run either
    // (the loop guard): only a delegation hands one agent's work to another.
    const comment = await coder.runner.issues({ issueId: fired.issueId! }).comments.post({
      body: '@seo bitte übernimm die Zusammenfassung',
    });
    expect(comment.status).toBe(201);
    expect(await runsOn(fired.issueId!)).toEqual([]);
  });

  it('keeps a routine run quiet: no subscription, one mention a day, a blocked question always', async () => {
    const { owner, asOwner, writer, coder, column } = await setup();
    const member = await agentAdmin(asOwner);
    const created = (await routines(asOwner).post(routineBody(writer.id, INSTRUCTIONS))).data!;
    const run = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const fired = await waitForStatus(run.runId, 'succeeded');
    const taskId = fired.issueId!;
    // The routine filed the task: its author does not follow it.
    expect(await db.select().from(issueWatcher).where(eq(issueWatcher.issueId, taskId))).toEqual(
      [],
    );
    // A member follows it by hand.
    await member.api.issues({ issueId: taskId }).watch.post();
    expect(
      (await db.select().from(issueWatcher).where(eq(issueWatcher.issueId, taskId))).length,
    ).toBe(1);

    // Both agents work on the fire's runs now.
    const delegation = (await writer.runner['agent-runs'].claim.post()).data!.run!;
    const mention = (await coder.runner['agent-runs'].claim.post()).data!.run!;
    const onTask = (runner: Api) => runner.issues({ issueId: taskId });

    // An agent that tags the owner anyway reaches him once that day; its comments and
    // status change tell the member who follows the task nothing.
    await onTask(writer.runner).comments.post({ body: `@${owner.username} Bericht ist fertig` });
    await onTask(coder.runner).comments.post({ body: `@${owner.username} Abhängigkeiten ok` });
    await onTask(writer.runner).comments.post({ body: `@${owner.username} noch ein Nachtrag` });
    await onTask(writer.runner).patch({ columnId: column('Done') });
    expect(await mentionsOf(owner.userId)).toEqual([{ type: 'mentioned', issueId: taskId }]);
    expect(await mentionsOf(member.userId)).toEqual([]);

    // A question the agent cannot go on without always reaches the person responsible.
    const blocked = await onTask(writer.runner).blocked.post({ question: 'Welche Version?' });
    expect(blocked.status).toBe(201);
    expect(await mentionsOf(owner.userId)).toEqual([
      { type: 'mentioned', issueId: taskId },
      { type: 'mentioned', issueId: taskId },
    ]);

    // Once its routine run is over, the agent talks the ordinary way again.
    for (const [runner, id] of [
      [writer.runner, delegation.id],
      [coder.runner, mention.id],
    ] as const)
      await runner['agent-runs']({ runId: id }).result.post({ status: 'success' });
    await onTask(writer.runner).comments.post({ body: `@${owner.username} Rückfrage beantwortet` });
    expect(await mentionsOf(owner.userId)).toHaveLength(3);
    expect(await mentionsOf(member.userId)).toEqual([{ type: 'commented', issueId: taskId }]);
  });

  it('reopens a task without telling its watchers, and tells nobody of the run', async () => {
    const { asOwner, writer, column } = await setup();
    const member = await agentAdmin(asOwner);
    const task = (
      await member.api
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: column('Done'), title: 'Backups' } as never)
    ).data!;
    const created = (
      await routines(asOwner).post(
        routineBody(writer.id, 'Prüfe die Backups.', { mode: 'reopen', taskId: task.id }),
      )
    ).data!;
    const run = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    await waitForStatus(run.runId, 'succeeded');
    const delegation = (await writer.runner['agent-runs'].claim.post()).data!.run!;
    expect(delegation.issueId).toBe(task.id);
    await writer.runner.issues({ issueId: task.id }).comments.post({ body: 'Backups ok' });
    await writer.runner.issues({ issueId: task.id }).patch({ columnId: column('Done') });
    // The member filed the task and follows it; the routine's work told them nothing.
    expect(await mentionsOf(member.userId)).toEqual([]);
    expect(
      await db
        .select()
        .from(notification)
        .where(and(eq(notification.issueId, task.id))),
    ).toEqual([]);
  });
});
