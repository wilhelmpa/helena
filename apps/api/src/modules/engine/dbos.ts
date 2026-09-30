import { hostname } from 'node:os';
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk';
import { ENGINE_TRIGGERS_TARGET } from '@repo/db';
import { intEnv } from '#shared/lib';

// The durable execution the Helena engine runs on: DBOS Transact, in process, with its
// state in the schema `helena_engine` of Helena's own database (see
// docs/helena-decisions/workflow-engine.md). This file owns the configuration and the
// lifecycle; the workflows are registered in workflows.ts before the launch.

let launching: Promise<void> | null = null;
let running = false;

// The name the engine's workflows and queues are registered under.
export const ENGINE_APP = 'helena';

// The schema of the engine's state in Helena's database.
export function engineSchema(): string {
  return process.env.HELENA_ENGINE_SCHEMA?.trim() || 'helena_engine';
}

function configure(): void {
  const url = process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required for the volition engine');
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
    // The worker serves the queue of the plugins' event subscribers; an api replica the
    // runs and the engine's own events.
    listenQueues: [RUNS_QUEUE, ENGINE_TRIGGERS_TARGET.queue],
  });
}

// Starts the engine once: creates or migrates its schema, recovers the runs this
// executor left pending, and starts the queues. Every later call waits for the first.
export function launchEngine(): Promise<void> {
  launching ??= (async () => {
    // The workflows have to be registered before the launch, and the built-in types and
    // subscribers before the first run.
    await import('./workflows');
    await import('./system-jobs');
    await import('../trash/job');
    const { registerBuiltins } = await import('./builtin/index');
    registerBuiltins();
    const { subscribeEngineTriggers } = await import('./events');
    subscribeEngineTriggers();
    configure();
    await DBOS.launch();
    // The queues of the runs and of the events. A run waiting for an agent or a person
    // holds its place in a queue, so the runs queue has no concurrency limit; events are
    // short and run ten at a time per replica.
    const minPollingIntervalMs = intEnv('HELENA_ENGINE_POLL_MS', 1000);
    await DBOS.registerQueue(RUNS_QUEUE, { minPollingIntervalMs, onConflict: 'always_update' });
    await DBOS.registerQueue(ENGINE_TRIGGERS_TARGET.queue, {
      minPollingIntervalMs,
      workerConcurrency: 10,
      onConflict: 'always_update',
    });
    // From now on the bus stores every event with its change (D-C2).
    const [{ useEventTransport }, { engineEventTransport }] = await Promise.all([
      import('#shared/helena'),
      import('./events'),
    ]);
    useEventTransport(engineEventTransport);
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

// Stops the engine and closes the client's connections (the engine starts again with
// launchEngine).
export async function stopEngine(): Promise<void> {
  const open = client;
  client = null;
  await (await open?.catch(() => null))?.destroy();
  if (!launching) return;
  await launching.catch(() => {});
  running = false;
  launching = null;
  // Back to delivering in process while no engine runs here.
  (await import('#shared/helena')).useEventTransport(null);
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

// The queue of the runs. It does not limit how many run at once: a run spends most of
// its time waiting. The outbox's queue is in events.ts.
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
