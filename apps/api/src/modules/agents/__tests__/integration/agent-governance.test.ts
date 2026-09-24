import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { queueStepRun } from '#modules/engine/agent-runs';
import { registerBuiltins } from '#modules/engine/builtin/index';

// Pausing an agent and its token ceilings. A paused agent takes no new work: its queued
// runs wait, a mention or a delegation queues nothing, a chat message and an agent-team
// stage are refused. A ceiling that is reached pauses the agent and tells the owner of
// the ceiling on the issue the work was for.

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
    triggerOnAssign: true,
    delegationDelaySec: 0,
  });
  return {
    owner,
    asOwner,
    columnId: view.columns[0].id,
    projectId: view.project.id,
    teamId: view.project.teamId,
    agent: created.data!.agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

async function newIssue(asOwner: Api, columnId: number, title = 'Landing page') {
  return (await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title })).data!;
}

async function mention(asOwner: Api, issueId: number) {
  await asOwner.issues({ issueId }).comments.post({ body: 'please look @ext' });
}

async function runsOf(asOwner: Api, teamId: number, agentId: number) {
  return (await asOwner.teams({ teamId })['ai-agents']({ agentId }).runs.get()).data!.items;
}

async function orgAgent(asOwner: Api, teamId: number, agentId: number) {
  const organization = (await asOwner.teams({ teamId }).organization.get()).data!;
  return organization.agents.find((entry) => entry.id === agentId)!;
}

// Claims the next run and reports it finished with the given token counts.
async function runWith(asRunner: Api, inputTokens: number, outputTokens: number) {
  const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
  await asRunner['agent-runs']({ runId: run.id }).result.post({
    status: 'success',
    output: 'Done',
    usage: { inputTokens, outputTokens },
  });
  return run;
}

async function comments(asOwner: Api, issueId: number) {
  const feed = await asOwner.issues({ issueId }).feed.get({ query: {} });
  return feed.data!.items.filter((item) => item.kind === 'comment').map((item) => item.body);
}

registerBuiltins();

describe('agent pause', () => {
  beforeEach(resetDb);

  it('keeps a queued run waiting until the agent is resumed', async () => {
    const { asOwner, asRunner, agent, teamId, columnId } = await setup();
    const issue = await newIssue(asOwner, columnId);
    await mention(asOwner, issue.id);
    const organization = asOwner.teams({ teamId }).organization;

    expect(
      (await organization.agents({ agentId: agent.id }).pause.post({ reason: 'Budget review' }))
        .status,
    ).toBe(204);
    expect(await orgAgent(asOwner, teamId, agent.id)).toMatchObject({
      pausedAt: expect.anything(),
      pauseReason: 'Budget review',
    });
    expect(
      (await asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id }).get()).data,
    ).toMatchObject({ pausedAt: expect.anything(), pauseReason: 'Budget review' });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();

    expect((await organization.agents({ agentId: agent.id }).resume.post()).status).toBe(204);
    expect(await orgAgent(asOwner, teamId, agent.id)).toMatchObject({
      pausedAt: null,
      pauseReason: null,
    });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      issueId: issue.id,
    });
  });

  it('names who paused the agent when no reason is given', async () => {
    const { asOwner, agent, teamId } = await setup();
    const pause = asOwner.teams({ teamId }).organization.agents({ agentId: agent.id }).pause;

    expect((await pause.post({})).status).toBe(204);
    expect((await orgAgent(asOwner, teamId, agent.id)).pauseReason).toBe('Paused by Owner.');
    expect((await pause.post({ reason: 'x'.repeat(501) })).status).toBe(400);
  });

  it('queues nothing for a mention or a delegation of a paused agent', async () => {
    const { asOwner, agent, teamId, columnId } = await setup();
    const issue = await newIssue(asOwner, columnId);
    const organization = asOwner.teams({ teamId }).organization;
    await organization.agents({ agentId: agent.id }).pause.post({});

    await mention(asOwner, issue.id);
    await asOwner.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });
    expect(await runsOf(asOwner, teamId, agent.id)).toHaveLength(0);

    await organization.agents({ agentId: agent.id }).resume.post();
    await mention(asOwner, issue.id);
    expect(await runsOf(asOwner, teamId, agent.id)).toHaveLength(1);
  });

  it('refuses a chat message to a paused agent', async () => {
    const { asOwner, agent, teamId } = await setup();
    await asOwner.teams({ teamId }).organization.agents({ agentId: agent.id }).pause.post({
      reason: 'Budget review',
    });

    const res = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Hello' });
    expect(res.status).toBe(409);
    expect(res.error?.value).toMatchObject({ error: 'The agent is paused: Budget review' });
  });

  it('refuses an agent-team stage for a paused agent', async () => {
    const { asOwner, agent, teamId, columnId } = await setup();
    const issue = await newIssue(asOwner, columnId);
    await asOwner.teams({ teamId }).organization.agents({ agentId: agent.id }).pause.post({
      reason: 'Budget review',
    });

    const res = await queueStepRun({
      agentId: agent.id,
      projectId: issue.projectId,
      issueId: issue.id,
      prompt: 'Complete the assignment.',
    }).then(
      () => ({ status: 200, error: null }),
      (error: Error) => ({ status: 409, error: { value: { error: error.message } } }),
    );
    expect(res.status).toBe(409);
    expect(res.error?.value).toEqual({ error: '@ext is paused: Budget review' });
    expect(await runsOf(asOwner, teamId, agent.id)).toHaveLength(0);
  });

  it('answers 404 for an agent of another team and 403 for a plain member', async () => {
    const { asOwner, agent, teamId } = await setup();
    const organization = asOwner.teams({ teamId }).organization;
    expect((await organization.agents({ agentId: agent.id + 1000 }).pause.post({})).status).toBe(
      404,
    );
    expect((await organization.agents({ agentId: agent.id + 1000 }).resume.post()).status).toBe(
      404,
    );

    const asMember = await addProjectMember(asOwner, 'MKT');
    const asMembersOrganization = asMember.teams({ teamId }).organization;
    expect((await asMembersOrganization.agents({ agentId: agent.id }).pause.post({})).status).toBe(
      403,
    );
  });
});

describe('token ceilings', () => {
  beforeEach(resetDb);

  it('shows what the agents and the project used against their ceilings', async () => {
    const { asOwner, asRunner, agent, teamId, projectId, columnId } = await setup();
    const organization = asOwner.teams({ teamId }).organization;
    expect(
      (
        await organization
          .agents({ agentId: agent.id })
          ['token-ceilings'].put({ daily: 1_000, monthly: 5_000 })
      ).status,
    ).toBe(204);
    expect(
      (await organization.projects({ projectId })['token-ceiling'].put({ monthly: 10_000 })).status,
    ).toBe(204);
    await mention(asOwner, (await newIssue(asOwner, columnId)).id);
    await runWith(asRunner, 100, 20);

    const snapshot = (await organization.get()).data!;
    expect(snapshot.agents.find((entry) => entry.id === agent.id)).toMatchObject({
      dailyTokenCeiling: 1_000,
      monthlyTokenCeiling: 5_000,
      tokensToday: 120,
      tokensThisMonth: 120,
      pausedAt: null,
    });
    expect(snapshot.projects.find((entry) => entry.id === projectId)).toMatchObject({
      monthlyTokenCeiling: 10_000,
      tokensThisMonth: 120,
    });
  });

  it('pauses the agent once a run reaches its daily ceiling and tells its owner', async () => {
    const { owner, asOwner, asRunner, agent, teamId, columnId } = await setup();
    const organization = asOwner.teams({ teamId }).organization;
    await organization
      .agents({ agentId: agent.id })
      ['token-ceilings'].put({ daily: 100, monthly: null });
    const issue = await newIssue(asOwner, columnId);
    await mention(asOwner, issue.id);

    await runWith(asRunner, 80, 30);

    const paused = await orgAgent(asOwner, teamId, agent.id);
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.pauseReason).toBe(
      'Budget reached: daily token budget, 110 of 100 tokens used today (UTC).',
    );
    expect(await comments(asOwner, issue.id)).toContainEqual(
      expect.stringContaining(`@${owner.username} I am paused and take no new work.`),
    );
    const inbox = await asOwner.notifications.get({ query: { types: 'mentioned' } });
    expect(inbox.data!.items).toMatchObject([{ issueId: issue.id, actorName: 'Ext Bot' }]);

    const resume = await organization.agents({ agentId: agent.id }).resume.post();
    expect(resume.status).toBe(409);
    expect(
      (
        await organization
          .agents({ agentId: agent.id })
          ['token-ceilings'].put({ daily: 1_000, monthly: null })
      ).status,
    ).toBe(204);
    expect((await organization.agents({ agentId: agent.id }).resume.post()).status).toBe(204);
  });

  it('pauses the agent at the claim when a ceiling set since is already reached', async () => {
    const { owner, asOwner, asRunner, agent, teamId, columnId } = await setup();
    await mention(asOwner, (await newIssue(asOwner, columnId)).id);
    await runWith(asRunner, 100, 20);
    await asOwner
      .teams({ teamId })
      .organization.agents({ agentId: agent.id })
      ['token-ceilings'].put({ daily: null, monthly: 100 });
    const issue = await newIssue(asOwner, columnId, 'Pricing page');
    await mention(asOwner, issue.id);

    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
    expect((await orgAgent(asOwner, teamId, agent.id)).pauseReason).toBe(
      'Budget reached: monthly token budget, 120 of 100 tokens used this month (UTC).',
    );
    expect(await comments(asOwner, issue.id)).toContainEqual(
      expect.stringContaining(`@${owner.username} I am paused`),
    );
    // The run waits in the queue for the agent to be resumed.
    expect((await runsOf(asOwner, teamId, agent.id))[0]).toMatchObject({
      issueId: issue.id,
      status: 'pending',
    });
  });

  it("holds the project's work when the project's monthly budget is reached", async () => {
    const { owner, asOwner, asRunner, agent, teamId, projectId, columnId } = await setup();
    const organization = asOwner.teams({ teamId }).organization;
    await organization.projects({ projectId })['token-ceiling'].put({ monthly: 100 });
    const issue = await newIssue(asOwner, columnId);
    await mention(asOwner, issue.id);

    await runWith(asRunner, 80, 30);

    // The agent itself is not paused: it may work in the team's other projects.
    expect((await orgAgent(asOwner, teamId, agent.id)).pausedAt).toBeNull();
    expect(await comments(asOwner, issue.id)).toContainEqual(
      expect.stringContaining(
        `@${owner.username} The work of project MKT is on hold. Budget reached: monthly token ` +
          'budget of project MKT, 110 of 100 tokens used this month (UTC).',
      ),
    );
    // Its next run in the project waits in the queue.
    await mention(asOwner, (await newIssue(asOwner, columnId, 'Pricing page')).id);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
    // Raising the budget lets it go on.
    await organization.projects({ projectId })['token-ceiling'].put({ monthly: 1_000 });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).not.toBeNull();
  });

  it('refuses a stage once the ceiling is reached', async () => {
    const { asOwner, asRunner, agent, teamId, columnId } = await setup();
    await mention(asOwner, (await newIssue(asOwner, columnId)).id);
    await runWith(asRunner, 100, 20);
    await asOwner
      .teams({ teamId })
      .organization.agents({ agentId: agent.id })
      ['token-ceilings'].put({ daily: 50, monthly: null });
    const issue = await newIssue(asOwner, columnId, 'Team task');

    const res = await queueStepRun({
      agentId: agent.id,
      projectId: issue.projectId,
      issueId: issue.id,
      prompt: 'Complete the assignment.',
    }).then(
      () => ({ status: 200, error: null }),
      (error: Error) => ({ status: 409, error: { value: { error: error.message } } }),
    );
    expect(res.status).toBe(409);
    expect((await orgAgent(asOwner, teamId, agent.id)).pausedAt).not.toBeNull();
  });

  it('accepts no ceiling below one token', async () => {
    const { asOwner, agent, teamId, projectId } = await setup();
    const organization = asOwner.teams({ teamId }).organization;
    const ceilings = organization.agents({ agentId: agent.id })['token-ceilings'];

    expect((await ceilings.put({ daily: 0, monthly: null })).status).toBe(400);
    expect((await ceilings.put({ daily: null, monthly: -5 })).status).toBe(400);
    expect((await ceilings.put({ daily: 1, monthly: null })).status).toBe(204);
    expect(
      (await organization.projects({ projectId })['token-ceiling'].put({ monthly: 0 })).status,
    ).toBe(400);
    expect(
      (
        await organization.projects({ projectId: projectId + 1000 })['token-ceiling'].put({
          monthly: null,
        })
      ).status,
    ).toBe(404);
  });
});

describe('automated runs per issue', () => {
  beforeEach(resetDb);

  it('queues a second run of the agent on an issue only once the first one ended', async () => {
    const { asOwner, asRunner, agent, teamId, columnId } = await setup();
    const issue = await newIssue(asOwner, columnId);

    await mention(asOwner, issue.id);
    await mention(asOwner, issue.id);
    expect(await runsOf(asOwner, teamId, agent.id)).toHaveLength(1);

    await runWith(asRunner, 1, 1);
    await mention(asOwner, issue.id);
    expect(await runsOf(asOwner, teamId, agent.id)).toHaveLength(2);
  });
});
