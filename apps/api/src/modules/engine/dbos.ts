import { hostname } from 'node:os';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { intEnv } from '#shared/lib';

// The durable execution the Helena engine runs on: DBOS Transact, in process, with its
// state in the schema `helena_engine` of Helena's own database (see
// docs/helena-decisions/workflow-engine.md). This file owns the configuration and the
// lifecycle; the workflows are registered in workflows.ts before the launch.

let launching: Promise<void> | null = null;
let running = false;

// The name every Helena workflow, queue and schedule is registered under.
export const ENGINE_APP = 'helena';

function configure(): void {
  const url = process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required for the Helena engine');
  DBOS.setConfig({
    name: ENGINE_APP,
    systemDatabaseUrl: url,
    systemDatabaseSchemaName: process.env.HELENA_ENGINE_SCHEMA?.trim() || 'helena_engine',
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
