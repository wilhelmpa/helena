import { sql, type SQL } from 'drizzle-orm';
import type { HelenaEvent } from '@helena/sdk';
import { db } from './client';

// The Helena engine's side of the domain event bus (@helena/sdk EventTransport, decision
// D-C2; docs/helena-decisions/workflow-engine.md): an event is stored as a workflow of the
// engine (DBOS) on a queue, once for each process that serves subscribers of it. The api's
// engine hands it to the workflow triggers; the worker to the durable subscribers of its
// plugins (outgoing webhooks among them). There is no table and no claim loop of Helena's
// own: the queue is DBOS's.
//
// The event is enqueued with DBOS's own SQL function, so it is written in the change's
// transaction when one is passed: the event exists exactly when its change does. The id of
// the workflow holds the event's id, so storing an event again (a retry, a replayed step)
// changes nothing.
export const ENGINE_EVENT_TARGETS = [
  { workflow: 'helena.event', queue: 'helena-events', prefix: 'event' },
  { workflow: 'helena.worker-event', queue: 'helena-events-worker', prefix: 'worker-event' },
] as const;

export type EngineEventTarget = (typeof ENGINE_EVENT_TARGETS)[number];

// The api's target alone: an event only the engine's triggers listen to.
export const ENGINE_TRIGGERS_TARGET = ENGINE_EVENT_TARGETS[0];

export function engineSchemaName(): string {
  return process.env.HELENA_ENGINE_SCHEMA?.trim() || 'helena_engine';
}

interface Executor {
  execute(query: SQL): Promise<unknown>;
}

export async function enqueueEngineEvents(
  events: HelenaEvent[],
  tx?: unknown,
  targets: readonly EngineEventTarget[] = ENGINE_EVENT_TARGETS,
): Promise<void> {
  const executor = (tx ?? db) as Executor;
  for (const event of events)
    for (const target of targets)
      await executor.execute(
        sql`select ${sql.identifier(engineSchemaName())}.enqueue_workflow(${target.workflow}, ${target.queue}, array[${JSON.stringify(event)}::json], '{}'::json, null, null, ${`${target.prefix}:${event.id}`})`,
      );
}
