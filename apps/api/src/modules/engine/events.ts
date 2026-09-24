import { createHash } from 'node:crypto';
import { createEvent, type EventTransport, type HelenaEvent as BusEvent } from '@helena/sdk';
import {
  db,
  ENGINE_TRIGGERS_TARGET,
  enqueueEngineEvents,
  pipeline,
  pipelineVersion,
  projectPipeline,
} from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { events as bus } from '#shared/helena';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { checkPipelineRunLimit } from '#modules/pipelines/rate-limit';
import { createRun } from '#modules/pipelines/runs';
import { registerBuiltins } from './builtin/index';
import { subscribeDomainEvents, triggersFor } from './registry';
import { startRunSoon } from './runs';
import type { DomainEvent, OutboxStore } from './sdk';

// Domain events and how they reach the engine. Helena has one event bus (@helena/sdk,
// shared/helena.ts); the engine is its durable transport (decision D-C2,
// docs/helena-decisions/workflow-engine.md): while the engine runs in this process, every
// event the bus publishes is stored as a DBOS workflow, once for the api's engine
// (`helena.event` on the queue `helena-events`, which hands it to the workflow triggers)
// and once for the worker (`helena.worker-event`, which hands it to the durable subscribers
// of the plugins). The event is stored in the change's transaction when there is one.
// There is no table and no claim loop of our own.

export const EVENTS_QUEUE = ENGINE_TRIGGERS_TARGET.queue;

// The actor attribute of an event a workflow caused: its changes start no workflow, so
// two workflows cannot start each other in turn.
export const WORKFLOW_EVENT_ACTOR = 'system:workflow';

export interface HelenaEvent<
  D extends Record<string, unknown> = Record<string, unknown>,
> extends DomainEvent<D> {
  datacontenttype?: 'application/json';
  // CloudEvents extension attribute: who caused the event ('system:workflow' for a
  // workflow's own change, `user:<id>`, a user id, or absent).
  helenaactor?: string;
}

// An event of the engine's own kinds (a task changed, a mail arrived) in the bus's shape.
export function domainEvent<D extends Record<string, unknown>>(
  type: string,
  projectId: number,
  data: D,
  options: { subject?: string; actor?: string | null; id?: string } = {},
): HelenaEvent<D> {
  return createEvent({
    type,
    data,
    projectId,
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.id ? { id: options.id } : {}),
  }) as unknown as HelenaEvent<D>;
}

// The transport this api process hands the bus while its engine runs (dbos.ts). The api
// serves only the engine's own subscribers, through `helena.event`; a plugin's durable
// subscriber is served in the worker (apps/worker/src/engine-delivery.ts).
export const engineEventTransport: EventTransport = {
  append: (events, tx) => enqueueEngineEvents(events, tx),
  start: () => Promise.resolve({ stop: () => Promise.resolve() }),
};

// The engine's outbox: an event goes through the bus while the engine runs here, which
// stores it for every process that serves it; without the engine here it is stored for
// the triggers alone, which an engine replica runs.
export const outbox: OutboxStore = {
  async publish(event) {
    if (bus.transport()) await bus.publish(event as unknown as BusEvent);
    else
      await enqueueEngineEvents([event as unknown as BusEvent], undefined, [
        ENGINE_TRIGGERS_TARGET,
      ]);
  },
};

// Publishes an event. A failure is logged: the write that caused the event has happened
// and does not fail with it.
export async function publishDomainEvent(event: HelenaEvent): Promise<void> {
  try {
    await outbox.publish(event);
  } catch (error) {
    console.error(`[engine] event ${event.type} not published:`, error);
  }
}

// The enabled workflows of the project whose trigger listens to the event's type.
async function listeningWorkflows(projectId: number, triggerTypes: string[]) {
  const rows = await db
    .select({
      pipelineId: pipeline.id,
      versionId: pipelineVersion.id,
      name: pipeline.name,
      definition: pipelineVersion.definition,
    })
    .from(projectPipeline)
    .innerJoin(pipeline, eq(pipeline.id, projectPipeline.pipelineId))
    .innerJoin(
      pipelineVersion,
      and(
        eq(pipelineVersion.pipelineId, pipeline.id),
        eq(pipelineVersion.version, pipeline.version),
      ),
    )
    .where(and(eq(projectPipeline.projectId, projectId), eq(projectPipeline.enabled, true)))
    .orderBy(asc(pipeline.id));
  return rows.filter((row) =>
    triggerTypes.includes((row.definition as PipelineDefinition).trigger.type),
  );
}

// The engine's own subscriber: starts the runs of the workflows whose trigger the event
// fires. One run per event and workflow, however often the event is handed over.
export async function startTriggeredRuns(event: DomainEvent): Promise<void> {
  const helena = event as HelenaEvent;
  registerBuiltins();
  if (helena.helenaactor === WORKFLOW_EVENT_ACTOR || helena.helenaproject == null) return;
  const types = triggersFor(event.type);
  if (types.length === 0) return;
  const projectId = helena.helenaproject;
  const byName = new Map(types.map((type) => [type.type, type]));
  for (const workflow of await listeningWorkflows(projectId, [...byName.keys()])) {
    const trigger = (workflow.definition as PipelineDefinition).trigger;
    const match = await byName.get(trigger.type)!.match?.(trigger as never, event);
    if (!match) continue;
    if (
      match.taskId !== null &&
      !(await checkPipelineRunLimit(
        { id: workflow.pipelineId, versionId: workflow.versionId, name: workflow.name },
        { id: match.taskId, projectId },
        trigger.type,
      ))
    )
      continue;
    const run = await createRun({
      id: `evt-${createHash('sha256').update(`${event.id}\0${workflow.pipelineId}`).digest('hex').slice(0, 40)}`,
      pipelineId: workflow.pipelineId,
      projectId,
      issueId: match.taskId,
      trigger: trigger.type,
      dryRun: false,
      actorUserId:
        helena.helenaactor && !helena.helenaactor.startsWith('system:') ? helena.helenaactor : null,
      ...(match.input ? { input: match.input } : {}),
    });
    if (run) await startRunSoon(run.id);
  }
}

let subscribed = false;

export function subscribeEngineTriggers(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeDomainEvents('engine_triggers', startTriggeredRuns);
}
