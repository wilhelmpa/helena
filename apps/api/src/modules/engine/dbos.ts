import { hostname } from 'node:os';
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk';
import { intEnv } from '#shared/lib';

// The durable execution the Helena engine runs on: DBOS Transact, in process, with its
// state in the schema `helena_engine` of Helena's own database (see
// docs/helena-decisions/workflow-engine.md). This file owns the configuration and the
// lifecycle; the workflows are registered in workflows.ts before the launch.

let launching: Promise<void> | null = null;
let running = false;

// The name every Helena workflow, queue and schedule is registered under.
export const ENGINE_APP = 'helena';

// The schema of the engine's state in Helena's database.
export function engineSchema(): string {
  return process.env.HELENA_ENGINE_SCHEMA?.trim() || 'helena_engine';
}

function configure(): void {
  const url = process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required for the Helena engine');
  DBOS.setConfig({
    name: ENGINE_APP,
    systemDatabaseUrl: url,
    systemDatabaseSchemaName: engineSchema(),
    systemDatabasePoolSize: intEnv('HELENA_ENGINE_POOL_SIZE', 10),
    // Fixed, so a deploy recovers the runs the previous code left pending. The
    // interpreter stays replay-compatible across versions (DBOS.patch for changes).
    applicationVersion: process.env.HELENA_ENGINE_VERSION?.trim() || 'helena-engine-1',
    // Each api replica recovers its own runs after a restart; see janitor.ts for a
    // replica that is gone.
    executorID: process.env.HELENA_ENGINE_EXECUTOR_ID?.trim() || hostname(),
    logLevel: process.env.HELENA_ENGINE_LOG_LEVEL?.trim() || 'warn',
  });
}

// Starts the engine once: creates or migrates its schema, recovers the runs this
// executor left pending, and starts the schedules and queues. Every later call waits for
// the first.
export function launchEngine(): Promise<void> {
  launching ??= (async () => {
    // The workflows have to be registered before the launch.
    await import('./workflows');
    configure();
    await DBOS.launch();
    // The queues of the runs and of the outbox.
    const { EVENTS_QUEUE } = await import('./events');
    for (const queue of [RUNS_QUEUE, EVENTS_QUEUE])
      if (!(await DBOS.retrieveQueue(queue))) await DBOS.registerQueue(queue);
    running = true;
  })().catch((error: unknown) => {
    launching = null;
    throw error;
  });
  return launching;
}

export function engineRunning(): boolean {
  return running;
}

export async function stopEngine(): Promise<void> {
  if (!launching) return;
  await launching.catch(() => {});
  running = false;
  launching = null;
  await DBOS.shutdown();
}

export function engineExecutorId(): string {
  return DBOS.executorID;
}

// How long a waiting step sleeps before it looks again without a signal (an agent run
// that finished wakes it at once). HELENA_ENGINE_WAIT_SECONDS lowers it, e.g. in tests.
export function engineWaitSeconds(fallback: number): number {
  return Math.min(fallback, intEnv('HELENA_ENGINE_WAIT_SECONDS', fallback));
}

// The queues of the engine: the runs, and the outbox's events. Neither limits how many
// workflows run at once: a run spends most of its time waiting.
export const RUNS_QUEUE = 'helena-runs';

let client: Promise<DBOSClient> | null = null;

// A DBOS client on the engine's schema, for enqueueing where the engine itself may not
// start a workflow: inside a recorded operation of another workflow (a step that creates
// a task starts that task's workflows), or in a process that does not run the engine.
export function engineClient(): Promise<DBOSClient> {
  client ??= DBOSClient.create({
    systemDatabaseUrl:
      process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL!.trim(),
    systemDatabaseSchemaName: engineSchema(),
    applicationName: ENGINE_APP,
  }).catch((error: unknown) => {
    client = null;
    throw error;
  });
  return client;
}

// Enqueues a workflow of the engine under an id, once: a workflow of that id that exists
// is left as it is (DBOS keeps the first). Any executor's queue takes it.
export async function enqueueWorkflow(
  workflowName: string,
  queueName: string,
  workflowID: string,
  ...args: unknown[]
): Promise<void> {
  await (
    await engineClient()
  ).enqueue({ workflowName, queueName, workflowID }, ...(args as never[]));
}

// Whether the caller runs inside a recorded operation, where DBOS starts no workflow.
export function insideOperation(): boolean {
  return DBOS.isInStep() || DBOS.isInTransaction();
}
