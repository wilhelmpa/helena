import { hostname } from 'node:os';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  matchesEventPattern,
  type EventSubscription,
  type EventTransport,
  type HelenaEvent,
} from '@helena/sdk';
import { ENGINE_EVENT_TARGETS, engineSchemaName, enqueueEngineEvents } from '@repo/db';
import { intEnv } from './env';

// The worker's half of the engine's event transport (decision D-C2; the api's half is
// apps/api/src/modules/engine/events.ts): the worker runs the engine's DBOS runtime for
// one queue only, `helena-events-worker`, where every domain event is stored once, and
// hands each event to the durable subscribers of its plugins (outgoing webhooks among
// them). Each subscriber is one recorded step, retried with backoff, so a subscriber runs
// once per event and again only after it failed; one that keeps failing delays only
// itself. The worker's executor recovers its unfinished deliveries when it starts again.

const WORKER_TARGET = ENGINE_EVENT_TARGETS[1];

let subscriptions: (() => EventSubscription[]) | null = null;

function durableFor(event: HelenaEvent): EventSubscription[] {
  return (subscriptions?.() ?? []).filter(
    (sub) =>
      sub.durable && sub.patterns.some((pattern) => matchesEventPattern(pattern, event.type)),
  );
}

async function deliver(event: HelenaEvent): Promise<void> {
  // Which subscribers take the event is recorded first, so a delivery resumed after a
  // restart runs the same ones even when a plugin was loaded or removed meanwhile.
  const ids = await DBOS.runStep(() => Promise.resolve(durableFor(event).map((sub) => sub.id)), {
    name: 'helena:route',
  });
  for (const id of ids) {
    try {
      await DBOS.runStep(
        async () => {
          const sub = (subscriptions?.() ?? []).find((item) => item.id === id);
          if (sub) await sub.handler(event);
        },
        {
          name: `helena:deliver:${id}`,
          retriesAllowed: true,
          maxAttempts: intEnv('HELENA_EVENT_MAX_ATTEMPTS', 10),
          intervalSeconds: intEnv('HELENA_EVENT_RETRY_SECONDS', 5),
          backoffRate: 2,
        },
      );
    } catch (error) {
      console.error(`[events] ${id} gave up on ${event.type} ${event.id}:`, error);
    }
  }
}

DBOS.registerWorkflow(deliver, { name: WORKER_TARGET.workflow });

let launching: Promise<void> | null = null;

function launch(): Promise<void> {
  launching ??= (async () => {
    const url = process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (!url) throw new Error('DATABASE_URL is required for event delivery');
    DBOS.setConfig({
      name: 'helena',
      systemDatabaseUrl: url,
      systemDatabaseSchemaName: engineSchemaName(),
      systemDatabasePoolSize: intEnv('HELENA_ENGINE_POOL_SIZE', 5),
      applicationVersion: process.env.HELENA_ENGINE_VERSION?.trim() || 'helena-engine-1',
      executorID: `${process.env.HELENA_ENGINE_EXECUTOR_ID?.trim() || hostname()}-worker`,
      logLevel: process.env.HELENA_ENGINE_LOG_LEVEL?.trim() || 'warn',
      listenQueues: [WORKER_TARGET.queue],
    });
    await DBOS.launch();
    await DBOS.registerQueue(WORKER_TARGET.queue, {
      minPollingIntervalMs: intEnv('HELENA_ENGINE_POLL_MS', 1000),
      workerConcurrency: 10,
      onConflict: 'always_update',
    });
  })().catch((error: unknown) => {
    launching = null;
    throw error;
  });
  return launching;
}

// The transport the worker's event bus hands its durable subscribers to.
export const workerEventTransport: EventTransport = {
  append: (events, tx) => enqueueEngineEvents(events, tx),
  async start(read) {
    subscriptions = read;
    await launch();
    return {
      async stop() {
        subscriptions = null;
        const current = launching;
        launching = null;
        if (current) {
          await current.catch(() => {});
          await DBOS.shutdown();
        }
      },
    };
  },
};
