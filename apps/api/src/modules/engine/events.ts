import { createHash, randomUUID } from 'node:crypto';
import { db, helenaEvent, pipeline, pipelineVersion, projectPipeline } from '@repo/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { checkPipelineRunLimit } from '#modules/pipelines/rate-limit';
import { createRun } from '#modules/pipelines/runs';
import { registerBuiltins } from './builtin/index';
import { triggersFor } from './registry';
import { startRunSoon } from './runs';
import type { DomainEvent } from './sdk';

// The domain events the engine's triggers listen to, in the CloudEvents 1.0 shape. The
// api publishes its own in process (a task created, assigned, moved, labelled); another
// process (the worker's mail import) writes them to the helena_event outbox, which the
// engine consumes. When hub/framework's event bus lands, publishDomainEvent hands the
// events to it and the triggers subscribe there instead.

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
  options: { subject?: string; actor?: string | null; source?: string } = {},
): HelenaEvent<D> {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: options.source ?? `/helena/projects/${projectId}`,
    type,
    ...(options.subject ? { subject: options.subject } : {}),
    time: new Date().toISOString(),
    helenaproject: projectId,
    ...(options.actor ? { helenaactor: options.actor } : {}),
    data,
  };
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

// Starts the runs an event triggers. A failure is logged: the write that caused the
// event has happened and does not fail with it.
export async function publishDomainEvent(event: HelenaEvent): Promise<void> {
  try {
    await dispatch(event);
  } catch (error) {
    console.error(`[engine] event ${event.type} not handled:`, error);
  }
}

async function dispatch(event: HelenaEvent): Promise<void> {
  registerBuiltins();
  if (event.helenaactor === WORKFLOW_EVENT_ACTOR || event.helenaproject == null) return;
  const types = triggersFor(event.type);
  if (types.length === 0) return;
  const byName = new Map(types.map((type) => [type.type, type]));
  for (const workflow of await listeningWorkflows(event.helenaproject, [...byName.keys()])) {
    const trigger = (workflow.definition as PipelineDefinition).trigger;
    const match = await byName.get(trigger.type)!.match?.(trigger as never, event);
    if (!match) continue;
    if (
      match.taskId !== null &&
      !(await checkPipelineRunLimit(
        { id: workflow.pipelineId, versionId: workflow.versionId, name: workflow.name },
        { id: match.taskId, projectId: event.helenaproject },
        trigger.type,
      ))
    )
      continue;
    const run = await createRun({
      pipelineId: workflow.pipelineId,
      projectId: event.helenaproject,
      issueId: match.taskId,
      trigger: trigger.type,
      dryRun: false,
      actorUserId:
        event.helenaactor && !event.helenaactor.startsWith('system:') ? event.helenaactor : null,
      ...(match.input ? { input: match.input } : {}),
      // One run per event and workflow, however often the event is handed over.
      id: `evt-${createHash('sha256').update(`${event.id}\0${workflow.pipelineId}`).digest('hex').slice(0, 40)}`,
    });
    if (run) await startRunSoon(run.id);
  }
}

// Writes an event for the engine from a process that cannot publish in process.
export async function enqueueDomainEvent(event: HelenaEvent): Promise<void> {
  await db.insert(helenaEvent).values({
    id: event.id,
    type: event.type,
    source: event.source,
    subject: event.subject ?? null,
    projectId: event.helenaproject ?? null,
    data: event.data,
    time: new Date(event.time),
  });
}

const MAX_ATTEMPTS = 5;

// Hands the outbox's events to the triggers, oldest first, once each. Several api
// replicas consume without overlapping.
export async function consumeDomainEvents(limit = 50): Promise<number> {
  const rows = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(helenaEvent)
      .where(and(isNull(helenaEvent.consumedAt), sql`${helenaEvent.attempts} < ${MAX_ATTEMPTS}`))
      .orderBy(asc(helenaEvent.time))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    await tx
      .update(helenaEvent)
      .set({ attempts: sql`${helenaEvent.attempts} + 1` })
      .where(
        inArray(
          helenaEvent.id,
          due.map((row) => row.id),
        ),
      );
    return due;
  });
  for (const row of rows) {
    const event: HelenaEvent = {
      specversion: '1.0',
      id: row.id,
      source: row.source,
      type: row.type,
      ...(row.subject ? { subject: row.subject } : {}),
      time: row.time.toISOString(),
      ...(row.projectId ? { helenaproject: row.projectId } : {}),
      data: row.data as Record<string, unknown>,
    };
    try {
      await dispatch(event);
      await db
        .update(helenaEvent)
        .set({ consumedAt: new Date(), lastError: null })
        .where(eq(helenaEvent.id, row.id));
    } catch (error) {
      await db
        .update(helenaEvent)
        .set({ lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) })
        .where(eq(helenaEvent.id, row.id));
    }
  }
  return rows.length;
}

// Consumed events are kept a week for tracing, then pruned.
export async function pruneDomainEvents(): Promise<number> {
  const rows = await db
    .delete(helenaEvent)
    .where(sql`${helenaEvent.consumedAt} < now() - interval '7 days'`)
    .returning({ id: helenaEvent.id });
  return rows.length;
}
