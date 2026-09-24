import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';
import { stepRunStatus } from '#modules/engine/agent-runs';

// An agent that cannot go on without a person's answer marks its issue blocked: the
// issue gets the Blocked label and the question as a comment that notifies the person
// the agent reports to, and the agent's run ends as a success carrying the question.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Writer',
    username: 'writer',
    kind: 'external',
    triggerOnMention: true,
  });
  const issue = (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId: view.columns[0].id, title: 'Landing page' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please write it @writer' });
  return {
    owner,
    asOwner,
    teamId: view.project.teamId,
    issue,
    agent: created.data!.agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

// A member of the project who owns an agent of their own, which the writer reports to.
async function addManager(asOwner: Api, teamId: number, agentId: number) {
  const role = await createRole(asOwner, 'MKT', {
    name: 'Agent handler',
    permissions: { ai_agents: { read: true, create: true, edit: true } },
  });
  const member = await signUpTestUser({ name: 'Lead Person' });
  const invite = await asOwner
    .projects({ projectKey: 'MKT' })
    .invites.post({ email: member.email, role: 'member', roleId: role.data!.id });
  const asMember = authedApi(member.cookie);
  await asMember.invites({ token: invite.data!.token }).accept.post();
  const lead = await createAgent(asMember, 'MKT', {
    name: 'Lead',
    username: 'lead',
    kind: 'external',
  });
  await asOwner
    .teams({ teamId })
    .organization.agents({ agentId })
    .put({ reportsToAgentId: lead.data!.agent.id });
  return { member, asMember };
}

describe('mark an issue blocked', () => {
  beforeEach(resetDb);

  it('asks the owner of the agent it reports to and ends the run as blocked', async () => {
    const { owner, asOwner, asRunner, teamId, issue, agent } = await setup();
    const { member, asMember } = await addManager(asOwner, teamId, agent.id);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner
      .issues({ issueId: issue.id })
      .blocked.post({ question: 'Which market comes first?' });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ runId: run.id });
    expect(res.data!.comment.body).toBe(
      `@${member.username} **Blocked, needs input:** Which market comes first?`,
    );
    expect(res.data!.comment.body).not.toContain(owner.username);

    const labels = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.labels;
    const blocked = labels.find((entry) => entry.name === 'Blocked')!;
    expect((await asOwner.issues({ issueId: issue.id }).get()).data!.labelIds).toContain(
      blocked.id,
    );
    const inbox = await asMember.notifications.get({ query: { types: 'mentioned' } });
    expect(inbox.data!.items).toMatchObject([{ issueId: issue.id, actorName: 'Writer' }]);

    // Whatever the command reports afterwards, the run ends as a success.
    await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'failed',
      error: 'Stopped after asking',
    });
    const runs = await asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id }).runs.get();
    expect(runs.data!.items[0]).toMatchObject({
      id: run.id,
      status: 'success',
      lastError: null,
      blockedQuestion: 'Which market comes first?',
    });
    // The engine reads a stage's run this way.
    expect(await stepRunStatus(run.id)).toMatchObject({
      status: 'success',
      blockedQuestion: 'Which market comes first?',
    });
  });

  it('asks the project owners when the agent reports to nobody', async () => {
    const { owner, asOwner, asRunner, issue } = await setup();

    const res = await asRunner
      .issues({ issueId: issue.id })
      .blocked.post({ question: 'Which tone?' });
    expect(res.status).toBe(201);
    // Outside a run the question is still asked; there is no run to mark.
    expect(res.data).toMatchObject({ runId: null });
    expect(res.data!.comment.body).toBe(`@${owner.username} **Blocked, needs input:** Which tone?`);
    const inbox = await asOwner.notifications.get({ query: { types: 'mentioned' } });
    expect(inbox.data!.items).toMatchObject([{ issueId: issue.id }]);
  });

  it('reuses the label the project already has for it', async () => {
    const { asOwner, asRunner, issue } = await setup();
    const own = await asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'blocked' });

    await asRunner.issues({ issueId: issue.id }).blocked.post({ question: 'Which tone?' });
    const labels = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.labels;
    expect(labels.filter((entry) => entry.name.toLowerCase() === 'blocked')).toHaveLength(1);
    expect((await asOwner.issues({ issueId: issue.id }).get()).data!.labelIds).toContain(
      own.data!.id,
    );
  });

  it("labels and asks in the project owner's language", async () => {
    const { owner, asOwner, asRunner, issue } = await setup();
    await asOwner.account.preferences.patch({ locale: 'de' });

    const res = await asRunner
      .issues({ issueId: issue.id })
      .blocked.post({ question: 'Welcher Ton?' });
    expect(res.data!.comment.body).toBe(
      `@${owner.username} **Blockiert, braucht eine Antwort:** Welcher Ton?`,
    );
    const labels = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.labels;
    const blocked = labels.find((entry) => entry.name === 'Blockiert')!;
    expect((await asOwner.issues({ issueId: issue.id }).get()).data!.labelIds).toContain(
      blocked.id,
    );
  });

  it('reuses the label under its name in another language', async () => {
    const { asOwner, asRunner, issue } = await setup();
    const own = await asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'Blocked' });
    await asOwner.account.preferences.patch({ locale: 'de' });

    await asRunner.issues({ issueId: issue.id }).blocked.post({ question: 'Welcher Ton?' });
    const labels = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.labels;
    expect(labels.map((entry) => entry.name)).not.toContain('Blockiert');
    expect((await asOwner.issues({ issueId: issue.id }).get()).data!.labelIds).toContain(
      own.data!.id,
    );
  });

  it('refuses a person and an empty question', async () => {
    const { asOwner, asRunner, issue } = await setup();
    expect(
      (await asOwner.issues({ issueId: issue.id }).blocked.post({ question: 'Which tone?' }))
        .status,
    ).toBe(403);
    expect(
      (await asRunner.issues({ issueId: issue.id }).blocked.post({ question: '' })).status,
    ).toBe(400);
    expect(
      (await asRunner.issues({ issueId: issue.id }).blocked.post({ question: 'x'.repeat(4001) }))
        .status,
    ).toBe(400);
    expect(
      (await asRunner.issues({ issueId: issue.id + 1000 }).blocked.post({ question: 'Why?' }))
        .status,
    ).toBe(404);
  });

  it('tells the agent in its SOUL.md when to use it', async () => {
    const { asRunner } = await setup();
    const policy = await asRunner['agent-runtime'].policy.get();
    const soul = policy.data!.runtimePolicy.files.find((file) => file.path === 'SOUL.md')!;
    expect(soul.content).toContain('## When you are blocked');
    expect(soul.content).toContain('mark_issue_blocked');
  });
});
