import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { runtimePolicySnapshot } from '#modules/agents/runtime-policy/service';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const mkt = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const ops = (await api.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const teamId = mkt.teamId;
  const organization = api.teams({ teamId }).organization;
  const department = (await organization.departments.post({ name: 'Growth' })).data!;
  await organization.projects({ projectId: mkt.id }).put({ departmentId: department.id });
  const created = await createAgent(api, 'MKT', {
    name: 'Writer',
    username: 'writer',
    kind: 'external',
  });
  const agent = created.data!.agent;
  const agentApi = apiKeyApi(created.data!.apiKey);
  const goal = async (body: Parameters<typeof organization.goals.post>[0]) =>
    (await organization.goals.post(body)).data!;
  const team = await goal({ title: 'Grow the company', status: 'active' });
  const growth = await goal({
    title: 'More leads',
    status: 'active',
    departmentId: department.id,
    parentGoalId: team.id,
  });
  const launch = await goal({
    title: 'Launch the new website',
    description: 'Astro site with a blog.',
    status: 'active',
    projectId: mkt.id,
    parentGoalId: growth.id,
    targetDate: '2026-11-30',
  });
  const opsGoal = await goal({ title: 'Cheaper hosting', status: 'active', projectId: ops.id });
  const later = await goal({ title: 'Podcast', status: 'planned', projectId: mkt.id });
  return {
    api,
    owner,
    teamId,
    mkt,
    ops,
    agent,
    agentApi,
    goals: { team, growth, launch, opsGoal, later },
  };
}

async function columnOf(api: ReturnType<typeof authedApi>, key: string, stateType: string) {
  const project = await api.projects({ projectKey: key }).get();
  return project.data!.columns.find((column) => column.stateType === stateType)!.id;
}

describe('goals', () => {
  beforeEach(resetDb);

  it('shows an agent the goals of its project, its department and the team, with their chain', async () => {
    const { api, teamId, agentApi, goals } = await setup();
    const seen = await agentApi.teams({ teamId }).goals.get({ query: {} });
    expect(seen.status).toBe(200);
    expect(seen.data!.map((goal) => goal.title).sort()).toEqual([
      'Grow the company',
      'Launch the new website',
      'More leads',
    ]);
    const launch = seen.data!.find((goal) => goal.id === goals.launch.id)!;
    expect(launch.path).toEqual(['Grow the company', 'More leads']);
    expect(launch.project).toMatchObject({ key: 'MKT' });

    const all = await agentApi.teams({ teamId }).goals.get({ query: { status: 'all' } });
    expect(all.data!.map((goal) => goal.title)).toContain('Podcast');
    expect(all.data!.map((goal) => goal.title)).not.toContain('Cheaper hosting');

    const hidden = await agentApi.teams({ teamId }).goals({ goalId: goals.opsGoal.id }).get();
    expect(hidden.status).toBe(404);

    // A person of the team sees every goal.
    const owner = await api.teams({ teamId }).goals.get({ query: {} });
    expect(owner.data!.map((goal) => goal.title)).toContain('Cheaper hosting');
  });

  it('links tasks to a goal on create and counts them in its progress', async () => {
    const { api, teamId, agentApi, goals } = await setup();
    const columnId = await columnOf(api, 'MKT', 'unstarted');
    const created = await agentApi.projects({ projectKey: 'MKT' }).issues.post({
      title: 'Write the landing page',
      columnId,
      goalId: goals.launch.id,
    });
    expect(created.status).toBe(201);

    // A goal the agent may not read creates no task.
    const before = (await api.projects({ projectKey: 'MKT' }).issues.get({ query: {} })).data;
    const refused = await agentApi.projects({ projectKey: 'MKT' }).issues.post({
      title: 'Move the hosting',
      columnId,
      goalId: goals.opsGoal.id,
    });
    expect(refused.status).toBe(404);
    const after = (await api.projects({ projectKey: 'MKT' }).issues.get({ query: {} })).data;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    const read = await agentApi.issues({ issueId: created.data!.id }).get();
    expect(read.data!.goal).toEqual({
      id: goals.launch.id,
      title: 'Launch the new website',
      status: 'active',
    });

    const detail = await agentApi.teams({ teamId }).goals({ goalId: goals.launch.id }).get();
    expect(detail.data!.tasks).toMatchObject([
      { identifier: 'MKT-1', title: 'Write the landing page', stateType: 'unstarted' },
    ]);
    expect(detail.data!.progress).toMatchObject({ total: 1, done: 0 });

    const organization = await api.teams({ teamId }).organization.get({ query: {} });
    const launch = organization.data!.goals.find((goal) => goal.id === goals.launch.id)!;
    expect(launch.progress).toMatchObject({ total: 1, done: 0 });

    // Done counts, unlinking takes it out.
    const doneColumn = await columnOf(api, 'MKT', 'completed');
    await api.issues({ issueId: created.data!.id }).patch({ columnId: doneColumn });
    const progressed = await agentApi.teams({ teamId }).goals({ goalId: goals.launch.id }).get();
    expect(progressed.data!.progress).toMatchObject({ total: 1, done: 1 });
    const unlinked = await agentApi
      .issues({ issueId: created.data!.id })
      .goal.put({ goalId: null });
    expect(unlinked.data).toEqual({ issueId: created.data!.id, goalId: null });
    const relinked = await agentApi
      .issues({ issueId: created.data!.id })
      .goal.put({ goalId: goals.opsGoal.id });
    expect(relinked.status).toBe(404);
    const emptied = await agentApi.teams({ teamId }).goals({ goalId: goals.launch.id }).get();
    expect(emptied.data!.tasks).toEqual([]);
  });

  it("lets an agent propose a status that only the team's owner decides", async () => {
    const { api, teamId, agentApi, goals } = await setup();
    const notes = agentApi.teams({ teamId }).goals({ goalId: goals.launch.id }).notes;
    const note = await notes.post({ body: 'The site is live.', proposedStatus: 'achieved' });
    expect(note.status).toBe(201);
    expect(note.data).toMatchObject({
      proposedStatus: 'achieved',
      decision: null,
      author: { username: 'writer', agent: true },
    });

    const still = await agentApi.teams({ teamId }).goals({ goalId: goals.launch.id }).get();
    expect(still.data!.status).toBe('active');
    const organization = await api.teams({ teamId }).organization.get({ query: {} });
    expect(
      organization.data!.goals.find((goal) => goal.id === goals.launch.id)!.pendingProposals,
    ).toBe(1);

    // The agent cannot decide; a person cannot propose.
    const decision = agentApi
      .teams({ teamId })
      .goals({ goalId: goals.launch.id })
      .notes({ noteId: note.data!.id }).decision;
    expect((await decision.post({ accept: true })).status).toBe(403);
    const ownerNote = await api
      .teams({ teamId })
      .goals({ goalId: goals.launch.id })
      .notes.post({ body: 'Looks good', proposedStatus: 'paused' });
    expect(ownerNote.status).toBe(400);

    const accepted = await api
      .teams({ teamId })
      .goals({ goalId: goals.launch.id })
      .notes({ noteId: note.data!.id })
      .decision.post({ accept: true });
    expect(accepted.status).toBe(200);
    expect(accepted.data).toMatchObject({ decision: 'accepted' });
    const achieved = await api.teams({ teamId }).goals({ goalId: goals.launch.id }).get();
    expect(achieved.data!.status).toBe('achieved');
    const again = await api
      .teams({ teamId })
      .goals({ goalId: goals.launch.id })
      .notes({ noteId: note.data!.id })
      .decision.post({ accept: false });
    expect(again.status).toBe(409);
  });

  it('puts the active goals that concern an agent into its SOUL.md', async () => {
    const { agent, goals } = await setup();
    const ref = (await getRunnerAgent(agent.userId))!;
    const soul = (await runtimePolicySnapshot(ref)).runtimePolicy.files[0]!.content;
    expect(soul).toContain('## Goals');
    expect(soul).toContain(
      `- #${goals.launch.id} "Launch the new website" — MKT; target 2026-11-30; part of: Grow the company › More leads`,
    );
    expect(soul).toContain('Astro site with a blog.');
    expect(soul).not.toContain('Cheaper hosting');
    expect(soul).not.toContain('Podcast');
  });
});
