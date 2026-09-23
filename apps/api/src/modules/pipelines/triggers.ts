import { db, label, pipeline, pipelineVersion, projectColumn, projectPipeline } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { actorId, type ActivityActor } from '#modules/issues/activity';
import type { PipelineDefinition, PipelineTrigger } from './definition';
import { createRun } from './runs';

// Task events that start the workflows a project runs on them. A run is planned in
// Plan and started by the api's background loop (drainPendingStarts), so the write
// that fired the event never waits for Mastra. A workflow that still works on the task starts no
// second run, and the changes a workflow makes itself start none.

export type TaskEvent =
  | { type: 'task_created' | 'task_assigned' }
  | { type: 'status_changed'; columnId: number }
  | { type: 'label_added'; labelIds: number[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function isWorkflow(actor: ActivityActor): boolean {
  return typeof actor === 'object' && actor !== null && actor.system === 'Workflow';
}

async function matches(trigger: PipelineTrigger, event: TaskEvent): Promise<boolean> {
  if (trigger.type !== event.type) return false;
  if (trigger.type === 'status_changed' && event.type === 'status_changed') {
    if (!trigger.to) return true;
    const [column] = await db
      .select({ name: projectColumn.name })
      .from(projectColumn)
      .where(eq(projectColumn.id, event.columnId));
    return column !== undefined && same(column.name, trigger.to);
  }
  if (trigger.type === 'label_added' && event.type === 'label_added') {
    if (event.labelIds.length === 0) return false;
    const names = await db
      .select({ name: label.name })
      .from(label)
      .where(inArray(label.id, event.labelIds));
    return names.some((item) => same(item.name, trigger.label));
  }
  return true;
}

export async function queuePipelineTriggers(
  task: { id: number; projectId: number },
  events: TaskEvent[],
  actor: ActivityActor,
): Promise<void> {
  if (events.length === 0 || isWorkflow(actor)) return;
  try {
    const enabled = await db
      .select({ pipelineId: pipeline.id, definition: pipelineVersion.definition })
      .from(projectPipeline)
      .innerJoin(pipeline, eq(pipeline.id, projectPipeline.pipelineId))
      .innerJoin(
        pipelineVersion,
        and(
          eq(pipelineVersion.pipelineId, pipeline.id),
          eq(pipelineVersion.version, pipeline.version),
        ),
      )
      .where(and(eq(projectPipeline.projectId, task.projectId), eq(projectPipeline.enabled, true)));
    for (const { pipelineId, definition } of enabled) {
      const { trigger } = definition as PipelineDefinition;
      for (const event of events) {
        if (!(await matches(trigger, event))) continue;
        await createRun({
          pipelineId,
          projectId: task.projectId,
          issueId: task.id,
          trigger: event.type,
          dryRun: false,
          actorUserId: actorId(actor),
        });
        break;
      }
    }
  } catch (error) {
    console.error('[planner] workflow triggers failed:', error);
  }
}
