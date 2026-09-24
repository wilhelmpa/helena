import { createHash, randomUUID } from 'node:crypto';
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk';
import { db, pipeline, pipelineVersion, projectPipeline } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { checkPipelineRunLimit } from '#modules/pipelines/rate-limit';
import { createRun } from '#modules/pipelines/runs';
import { registerBuiltins } from './builtin/index';
import { ENGINE_APP, engineRunning, engineSchema } from './dbos';
import { subscribeDomainEvents, triggersFor } from './registry';
import { startRunSoon } from './runs';
import type { DomainEvent, OutboxStore } from './sdk';

// Domain events in the CloudEvents 1.0 shape, and the outbox that hands them to their
// subscribers. The outbox runs on the engine itself (docs/helena-decisions/
// workflow-engine.md, D-C2): publishing an event enqueues the DBOS workflow `helena.event`
// under the event's id on the queue `helena-events`, which records the event durably and
// runs every subscriber once, in the background. A process that does not run the engine
// (the worker) enqueues through a DBOS client. There is no table and no claim loop of our
// own. The engine's triggers are the first subscriber; hub/framework's event bus and
// plugins subscribe the same way.

export const EVENTS_QUEUE = 'helena-events';

// The actor attribute of an event a workflow caused: its changes start no workflow, so
// two workflows cannot start each other in turn.
export const WORKFLOW_EVENT_ACTOR = 'system:workflow';

export interface HelenaEvent<
  D extends Record<string, unknown> = Record<string, unknown>,
> extends DomainEvent<D> {
  // CloudEvents extension attribute: who caused the event ('system:workflow' for a
  // workflow's own change, a user id, or absent).
  helenaactor?: string;
}

export function domainEvent<D extends Record<string, unknown>>(
  type: string,
  projectId: number,
  data: D,
  options: { subject?: string; actor?: string | null; source?: string; id?: string } = {},
): HelenaEvent<D> {
  return {
    specversion: '1.0',
    id: options.id ?? randomUUID(),
    source: options.source ?? `/helena/projects/${projectId}`,
    type,
    ...(options.subject ? { subject: options.subject } : {}),
    time: new Date().toISOString(),
    helenaproject: projectId,
    ...(options.actor ? { helenaactor: options.actor } : {}),
    data,
  };
}

export function eventWorkflowId(eventId: string): string {
  return `event:${eventId}`;
}

let client: Promise<DBOSClient> | null = null;

function engineClient(): Promise<DBOSClient> {
  client ??= DBOSClient.create({
    systemDatabaseUrl:
      process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL!.trim(),
    systemDatabaseSchemaName: engineSchema(),
    applicationName: ENGINE_APP,
  });
  return client;
}

// The engine's outbox.
export const outbox: OutboxStore = {
  async publish(event) {
    const workflowID = eventWorkflowId(event.id);
    if (engineRunning()) {
      const { eventWorkflow } = await import('./workflows');
      await DBOS.startWorkflow(eventWorkflow, { workflowID, queueName: EVENTS_QUEUE })(event);
      return;
    }
    await (
      await engineClient()
    ).enqueue({ workflowName: 'helena.event', queueName: EVENTS_QUEUE, workflowID }, event);
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
