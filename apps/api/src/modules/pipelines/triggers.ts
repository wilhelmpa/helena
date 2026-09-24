import { actorId, type ActivityActor } from '#modules/issues/activity';
import { domainEvent, publishDomainEvent, WORKFLOW_EVENT_ACTOR } from '#modules/engine/events';
import { TASK_EVENTS } from '#modules/engine/builtin/triggers';

// The task events of the issue service, published as domain events for the engine's
// triggers (modules/engine/events.ts). A run is planned and handed to the engine without
// the write that fired the event waiting for it. A workflow that still works on the task
// starts no second run, and the changes a workflow makes itself start none.

export type TaskEvent =
  | { type: 'task_created' | 'task_assigned' }
  | { type: 'status_changed'; columnId: number }
  | { type: 'label_added'; labelIds: number[] };

function isWorkflow(actor: ActivityActor): boolean {
  return typeof actor === 'object' && actor !== null && actor.system === 'Workflow';
}

const EVENT_TYPES: Record<TaskEvent['type'], string> = {
  task_created: TASK_EVENTS.created,
  task_assigned: TASK_EVENTS.assigned,
  status_changed: TASK_EVENTS.statusChanged,
  label_added: TASK_EVENTS.labelsAdded,
};

export async function queuePipelineTriggers(
  task: { id: number; projectId: number },
  events: TaskEvent[],
  actor: ActivityActor,
): Promise<void> {
  const by = isWorkflow(actor) ? WORKFLOW_EVENT_ACTOR : actorId(actor);
  for (const event of events) {
    const { type, ...data } = event;
    await publishDomainEvent(
      domainEvent(EVENT_TYPES[type], task.projectId, { taskId: task.id, ...data }, { actor: by }),
    );
  }
}
