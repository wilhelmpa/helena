import { afterEach, describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { agentRun, db } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { expireResumeLimitedRuns, RESUME_LIMIT_ERROR } from '../../service';

// A run whose runner died mid run resumes the same coding agent session instead of
// starting the task over, up to the instance's resume limit; past it, the run is left
// failed for the owner to look at instead of retried in silence forever.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
  });
  return {
    asOwner,
    columnId,
    agent: created.data!.agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

async function queueRun(asOwner: Api, columnId: number, username: string) {
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Landing page' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `please review @${username}` });
  return issue;
}

function withShortLease(maxAttempts = '5') {
  process.env.AGENT_RUN_LEASE_SECONDS = '1';
  process.env.AGENT_RUN_MAX_ATTEMPTS = maxAttempts;
}
const leaseRunsOut = () => Bun.sleep(1_100);

describe('run resume', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    delete process.env.AGENT_RUN_LEASE_SECONDS;
    delete process.env.AGENT_RUN_MAX_ATTEMPTS;
  });

  it('gives a pending run to only one parallel claimant of the same agent', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const claims = await Promise.all([
      asRunner['agent-runs'].claim.post(),
      asRunner['agent-runs'].claim.post(),
    ]);
    expect(claims.map((result) => result.data?.run).filter(Boolean)).toHaveLength(1);
  });

  it("saves a run's session as soon as the runner reports it, claim-fenced like every other route", async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const runs = asRunner['agent-runs']({ runId: run.id });

    const saved = await runs.session.post({ sessionId: 'sess-1' }, { query: { claim: run.claim } });
    expect(saved.status).toBe(204);
    const [row] = await db.select().from(agentRun).where(eq(agentRun.id, run.id));
    expect(row!.sessionId).toBe('sess-1');

    const stale = await runs.session.post({ sessionId: 'sess-stale' }, { query: { claim: 99 } });
    expect(stale.status).toBe(404);
    const [unchanged] = await db.select().from(agentRun).where(eq(agentRun.id, run.id));
    expect(unchanged!.sessionId).toBe('sess-1');
  });

  it('resumes a run whose lease ran out with the session it already had, instead of the original task', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    withShortLease();
    const first = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: first.id }).session.post(
      { sessionId: 'sess-resume-1' },
      { query: { claim: first.claim } },
    );
    await leaseRunsOut();

    const second = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(second).toMatchObject({ id: first.id, sessionId: 'sess-resume-1' });
    // Not the original mention prompt: the agent already has that context in the
    // session it is resuming.
    expect(second.prompt).not.toBe(first.prompt);
    expect(second.prompt.length).toBeGreaterThan(0);

    const [row] = await db.select().from(agentRun).where(eq(agentRun.id, first.id));
    expect(row!.resumes).toBe(1);
  });

  it('stops handing a run out once it has resumed as often as the instance allows', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    // The default limit is 3; put this run right at it, still pending and due.
    await db
      .update(agentRun)
      .set({
        sessionId: 'sess-limit-1',
        resumes: 3,
        nextAttemptAt: sql`now() - interval '1 second'`,
      })
      .where(eq(agentRun.id, claimed.id));

    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();

    expect(await expireResumeLimitedRuns()).toBe(1);
    const [row] = await db.select().from(agentRun).where(eq(agentRun.id, claimed.id));
    expect(row).toMatchObject({ status: 'failed', lastError: RESUME_LIMIT_ERROR });
    // A run below the limit is untouched by the same sweep.
    expect(await expireResumeLimitedRuns()).toBe(0);
  });

  it('takes the instance resume limit from Helena, owner only, and claiming honors it at once', async () => {
    const { asOwner, asRunner, columnId, agent } = await setup();
    const member = await signUpTestUser({ name: 'Member' });
    const asMember = authedApi(member.cookie);

    expect((await asMember.god['run-resume-settings'].get()).status).toBe(403);
    expect((await asOwner.god['run-resume-settings'].get()).data).toEqual({ maxResumes: 3 });

    const updated = await asOwner.god['run-resume-settings'].put({ maxResumes: 1 });
    expect(updated.data).toEqual({ maxResumes: 1 });

    await queueRun(asOwner, columnId, agent.username);
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await db
      .update(agentRun)
      .set({
        sessionId: 'sess-limit-2',
        resumes: 1,
        nextAttemptAt: sql`now() - interval '1 second'`,
      })
      .where(eq(agentRun.id, claimed.id));

    // Would still be under the default limit of 3; the lowered setting refuses it.
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
  });
});
