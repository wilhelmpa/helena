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
import {
  agentRun,
  db,
  helenaSchedule,
  issue as issueTable,
  issueActivity,
  pipelineRun,
  serviceHeartbeat,
} from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { stopEngine } from '#modules/engine/dbos';
import { resetDb } from '#tests/helpers/db';
import {
  cancelLeftovers,
  finishAgentRun,
  runSteps,
  waitForAgentRun,
  waitForStatus,
} from '#tests/helpers/engine';
import {
  agentStep,
  definition,
  enable,
  issue,
  setupProject,
  startRun,
  template,
  type Json,
  type ProjectSetup,
} from '#tests/helpers/workflows';

// Chaos tests of the engine with real processes: replicas of the engine run as child
// processes (engine-process.ts) against this run's test database, and the test kills
// them with SIGKILL in the middle of a run. This process does not run the engine; it
// plans runs and enqueues them, as an api replica without the engine would.

setDefaultTimeout(90_000);

const API_DIR = new URL('../../../../../', import.meta.url).pathname;

interface Replica {
  executorId: string;
  process: ReturnType<typeof Bun.spawn>;
}

const replicas: Replica[] = [];

async function startReplica(executorId: string): Promise<Replica> {
  const child = Bun.spawn(['bun', 'src/modules/engine/__tests__/chaos/engine-process.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      HELENA_ENGINE_EXECUTOR_ID: executorId,
      HELENA_ENGINE_WAIT_SECONDS: '1',
      HELENA_ENGINE_POLL_MS: '100',
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const replica = { executorId, process: child };
  replicas.push(replica);
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const deadline = Date.now() + 60_000;
  while (!seen.includes('ready')) {
    if (Date.now() > deadline) throw new Error(`Replica ${executorId} did not start`);
    const { value, done } = await reader.read();
    if (done) throw new Error(`Replica ${executorId} exited: ${seen}`);
    seen += decoder.decode(value);
  }
  reader.releaseLock();
  return replica;
}

async function kill(replica: Replica): Promise<void> {
  replica.process.kill('SIGKILL');
  await replica.process.exited;
}

async function workflow(ctx: ProjectSetup, steps: Json[]) {
  const created = await template(ctx, { definition: definition(steps) });
  expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
  return created.id;
}

const comment = (id: string, body: string) => ({
  id,
  name: id,
  type: 'action',
  action: { kind: 'comment', body },
});

async function commentsOf(issueId: number) {
  const rows = await db
    .select({ body: issueActivity.body })
    .from(issueActivity)
    .where(and(eq(issueActivity.issueId, issueId), eq(issueActivity.kind, 'comment')));
  return rows.map((row) => row.body).sort();
}

// The executor that ran each workflow, from the engine's own table.
async function executorsOf(workflowIds: string[]) {
  const rows = (await db.execute(sql`
    SELECT workflow_uuid AS id, executor_id AS executor
    FROM helena_engine.workflow_status
    WHERE workflow_uuid IN (${sql.join(
      workflowIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)) as unknown as { id: string; executor: string }[];
  return new Map(rows.map((row) => [row.id, row.executor]));
}

beforeAll(async () => {
  // Only the replicas run the engine.
  await stopEngine();
});

beforeEach(async () => {
  await resetDb();
  await cancelLeftovers();
});

afterEach(async () => {
  for (const replica of replicas.splice(0)) await kill(replica);
});

afterAll(async () => {
  for (const replica of replicas.splice(0)) await kill(replica);
});

describe('engine chaos', () => {
  it('continues a run whose process was killed mid-step, without repeating what was done', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      comment('before', 'Started {{task.title}}.'),
      agentStep('implement', 'Implement {{task.title}}.'),
      comment('after', 'Done: {{previous.summary}}'),
    ]);
    const task = await issue(ctx);
    const first = await startReplica('chaos-a');
    const run = await startRun(ctx, task.id, pipelineId);
    const agent = await waitForAgentRun(run.id, 'implement');
    // The replica dies while the step waits for the agent, and the agent finishes
    // meanwhile.
    await kill(first);
    await finishAgentRun(agent.id, { output: 'Built it.' });
    // The same replica comes back: it recovers its pending runs.
    await startReplica('chaos-a');
    await waitForStatus(run.id, 'succeeded');
    expect(await commentsOf(task.id)).toEqual(['Done: Built it.', 'Started Launch page.']);
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(1);
    expect((await runSteps(run.id)).map((row) => [row.stepId, row.status, row.attempt])).toEqual([
      ['before', 'succeeded', 1],
      ['implement', 'succeeded', 1],
      ['after', 'succeeded', 1],
    ]);
  });

  it('hands the runs of a replica that is gone for good to another', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      comment('before', 'Started.'),
      agentStep('implement', 'Implement {{task.title}}.'),
      comment('after', 'Finished.'),
    ]);
    const task = await issue(ctx);
    const gone = await startReplica('chaos-gone');
    const run = await startRun(ctx, task.id, pipelineId);
    const agent = await waitForAgentRun(run.id, 'implement');
    await kill(gone);
    // Its heartbeat stopped long ago, as far as the others can tell.
    await db
      .update(serviceHeartbeat)
      .set({ lastSeenAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(serviceHeartbeat.service, 'engine:chaos-gone'));
    await startReplica('chaos-other');
    await finishAgentRun(agent.id, { output: 'Built it.' });
    await waitForStatus(run.id, 'succeeded');
    expect(await commentsOf(task.id)).toEqual(['Finished.', 'Started.']);
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(1);
    const [heartbeat] = await db
      .select()
      .from(serviceHeartbeat)
      .where(eq(serviceHeartbeat.service, 'engine:chaos-gone'));
    expect(heartbeat).toBeUndefined();
  });

  it('runs every run and every schedule time once with two replicas', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [comment('one', 'One.'), comment('two', 'Two.')]);
    await Promise.all([startReplica('chaos-1'), startReplica('chaos-2')]);
    const tasks = [];
    for (let index = 0; index < 8; index += 1)
      tasks.push(await issue(ctx, { title: `Task ${index}` }));
    const runs = await Promise.all(tasks.map((task) => startRun(ctx, task.id, pipelineId)));
    for (const run of runs) await waitForStatus(run.id, 'succeeded');
    for (const task of tasks) expect(await commentsOf(task.id)).toEqual(['One.', 'Two.']);
    const executors = await executorsOf(runs.map((run) => run.id));
    expect([...executors.values()].every((id) => ['chaos-1', 'chaos-2'].includes(id))).toBe(true);

    // A routine whose time has come: both replicas tick, one run.
    const routine = (
      await ctx.asOwner.projects({ projectKey: 'MKT' }).routines.post({
        idempotencyKey: crypto.randomUUID(),
        agentId: ctx.coder.id,
        title: 'Daily check',
        instructions: 'Check the site.',
        mode: 'new',
        cron: '0 9 * * *',
        catchUp: 'once',
      } as never)
    ).data!;
    await db
      .update(helenaSchedule)
      .set({ firedThrough: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(helenaSchedule.id, routine.id));
    const deadline = Date.now() + 30_000;
    let routineRuns: (typeof pipelineRun.$inferSelect)[] = [];
    while (Date.now() < deadline) {
      routineRuns = await db
        .select()
        .from(pipelineRun)
        .where(eq(pipelineRun.scheduleId, routine.id));
      if (routineRuns.length > 0 && routineRuns.every((row) => row.status === 'succeeded')) break;
      await Bun.sleep(200);
    }
    // Give a late second fire time to show up.
    await Bun.sleep(1_500);
    routineRuns = await db.select().from(pipelineRun).where(eq(pipelineRun.scheduleId, routine.id));
    expect(routineRuns).toHaveLength(1);
    expect(routineRuns[0]).toMatchObject({ status: 'succeeded', trigger: 'schedule' });
    const created = await db
      .select({ id: issueTable.id })
      .from(issueTable)
      .where(and(eq(issueTable.projectId, ctx.projectId), eq(issueTable.title, 'Daily check')));
    expect(created).toHaveLength(1);
  });
});
