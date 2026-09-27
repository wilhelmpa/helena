import { describe, it, expect, beforeEach } from 'bun:test';
import { db, agentRun } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { enqueueAgentRun } from '../../run-queue';

// The agent_run outbox store: how a run is queued. The runner claims, leases and closes
// it over HTTP, which the runner tests cover. A run is enqueued through the store here
// and its state is read from the db.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  return { asOwner, columnId };
}

// Creates an agent and an issue, then enqueues a pending run for the pair.
async function enqueueRun(asOwner: Api, columnId: number) {
  const agent = (await createAgent(asOwner, 'MKT', { name: 'Bot', username: 'bot' })).data!.agent;
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Task' })
  ).data!;
  await enqueueAgentRun({
    agentId: agent.id,
    projectId: agent.projects[0].id,
    issueId: issue.id,
    sourceActivityId: null,
    prompt: 'do it',
  });
  const [row] = await db.select().from(agentRun).where(eq(agentRun.issueId, issue.id));
  return { agent, issue, runId: row.id };
}

async function readRun(runId: number) {
  const [row] = await db.select().from(agentRun).where(eq(agentRun.id, runId));
  return row;
}

describe('agent_run queue store', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enqueues a run as pending with zero attempts', async () => {
    const { asOwner, columnId } = await setup();
    const { runId } = await enqueueRun(asOwner, columnId);
    expect(await readRun(runId)).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
  });

  it('queues no second run of the agent on an issue while one is pending', async () => {
    const { asOwner, columnId } = await setup();
    const { agent, issue } = await enqueueRun(asOwner, columnId);
    const again = () =>
      enqueueAgentRun({
        agentId: agent.id,
        projectId: agent.projects[0].id,
        issueId: issue.id,
        sourceActivityId: null,
        prompt: 'again',
      });

    await Promise.all([again(), again()]);
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, issue.id))).toHaveLength(1);
  });

  it('queues a new subtask result when the previous run has already been claimed', async () => {
    const { asOwner, columnId } = await setup();
    const { agent, issue, runId } = await enqueueRun(asOwner, columnId);
    await db.update(agentRun).set({ claims: 1 }).where(eq(agentRun.id, runId));

    await enqueueAgentRun({
      agentId: agent.id,
      projectId: agent.projects[0].id,
      issueId: issue.id,
      sourceActivityId: null,
      trigger: 'subtask',
      prompt: 'Child MKT-2 completed',
    });
    await enqueueAgentRun({
      agentId: agent.id,
      projectId: agent.projects[0].id,
      issueId: issue.id,
      sourceActivityId: null,
      trigger: 'subtask',
      prompt: 'Child MKT-3 completed',
    });

    const runs = await db.select().from(agentRun).where(eq(agentRun.issueId, issue.id));
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.id === runId)?.prompt).toBe('do it');
    expect(runs.find((run) => run.id !== runId)?.prompt).toContain('Child MKT-2 completed');
    expect(runs.find((run) => run.id !== runId)?.prompt).toContain('Child MKT-3 completed');
  });
});
