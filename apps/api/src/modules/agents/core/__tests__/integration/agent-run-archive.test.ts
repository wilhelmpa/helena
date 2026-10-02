import { describe, it, expect, beforeEach } from 'bun:test';
import { agentRun, db, helenaAgentRunTombstone } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// Runs are never deleted to tidy up (code audit 2026-09-28: a third of all runs were gone,
// failures included): a finished run is archived, which takes it out of the run history,
// and a run deleted anyway (its agent, project or ticket deleted) is kept whole in
// helena_agent_run_tombstone by a trigger.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  return { asOwner, columnId, teamId: project.data!.teamId };
}

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];

// A run of a new agent, queued by mentioning it on a new ticket.
async function queuedRun(asOwner: Api, columnId: number, teamId: number) {
  const agent = (
    await createAgent(asOwner, 'MKT', {
      name: 'Design Bot',
      username: 'design',
      triggerOnMention: true,
    })
  ).data!.agent;
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Landing page' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please review @design' });
  const page = await agents(asOwner, teamId)({ agentId: agent.id }).runs.get();
  return { agent, issue, runId: page.data!.items[0]!.id };
}

describe('agent run archive', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('archives a finished run out of the history and brings it back', async () => {
    const { asOwner, columnId, teamId } = await setup();
    const { agent, runId } = await queuedRun(asOwner, columnId, teamId);
    const runs = agents(asOwner, teamId)({ agentId: agent.id }).runs;

    // Still in the queue: not archivable.
    expect((await runs({ runId }).archive.post()).status).toBe(409);

    await db
      .update(agentRun)
      .set({ status: 'failed', lastError: 'boom', finishedAt: new Date() })
      .where(eq(agentRun.id, runId));
    const archived = await runs({ runId }).archive.post();
    expect(archived.status).toBe(200);
    expect(archived.data!.archivedAt).not.toBeNull();

    expect((await runs.get()).data!.items).toHaveLength(0);
    const all = await runs.get({ query: { includeArchived: true } });
    expect(all.data!.items.map((run) => run.id)).toEqual([runId]);
    expect(all.data!.items[0]!.archivedAt).toEqual(archived.data!.archivedAt);

    // Archiving again keeps the first time.
    expect((await runs({ runId }).archive.post()).data!.archivedAt).toEqual(
      archived.data!.archivedAt,
    );

    const back = await runs({ runId }).unarchive.post();
    expect(back.status).toBe(200);
    expect(back.data!.archivedAt).toBeNull();
    expect((await runs.get()).data!.items.map((run) => run.id)).toEqual([runId]);
  });

  it('404s for a run of another agent', async () => {
    const { asOwner, columnId, teamId } = await setup();
    const { runId } = await queuedRun(asOwner, columnId, teamId);
    const other = (await createAgent(asOwner, 'MKT', { name: 'Other', username: 'other' })).data!
      .agent;
    const res = await agents(asOwner, teamId)({ agentId: other.id }).runs({ runId }).archive.post();
    expect(res.status).toBe(404);
  });

  it('keeps the runs of a permanently deleted agent in the tombstone table', async () => {
    const { asOwner, columnId, teamId } = await setup();
    const { agent, runId } = await queuedRun(asOwner, columnId, teamId);
    await db
      .update(agentRun)
      .set({ status: 'failed', lastError: 'boom' })
      .where(eq(agentRun.id, runId));

    expect((await agents(asOwner, teamId)({ agentId: agent.id }).delete()).status).toBe(204);

    expect(await db.select().from(agentRun).where(eq(agentRun.id, runId))).toHaveLength(1);
    expect(
      (
        await agents(
          asOwner,
          teamId,
        )({ agentId: agent.id }).delete(undefined, { query: { permanent: true } })
      ).status,
    ).toBe(204);

    expect(await db.select().from(agentRun).where(eq(agentRun.id, runId))).toHaveLength(0);
    const [kept] = await db
      .select()
      .from(helenaAgentRunTombstone)
      .where(eq(helenaAgentRunTombstone.runId, runId));
    expect(kept).toMatchObject({ runId, agentId: agent.id, status: 'failed', lastError: 'boom' });
    expect((kept!.row as { prompt?: string }).prompt).toContain('@design');
  });

  it('keeps the runs of a deleted ticket in the tombstone table', async () => {
    const { asOwner, columnId, teamId } = await setup();
    const { issue, runId } = await queuedRun(asOwner, columnId, teamId);
    expect((await asOwner.issues({ issueId: issue.id }).delete()).status).toBe(204);
    const kept = await db
      .select()
      .from(helenaAgentRunTombstone)
      .where(eq(helenaAgentRunTombstone.runId, runId));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.issueId).toBe(issue.id);
  });
});
