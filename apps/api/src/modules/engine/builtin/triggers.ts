import { db, label, projectColumn } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { minCronIntervalSeconds } from '#modules/routines/cron';
import type { DomainEvent, TriggerDefinition, WorkflowTriggerType } from '../sdk';

// The built-in trigger types. Task events and mail arrive as domain events; a schedule
// fires through the engine's tick (schedules.ts); a webhook through its hook route; `manual`
// starts a run only by hand. `delegation` (an agent team) and `routine` are the
// triggers of the built-in workflows the engine builds itself.

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Trigger<T> = TriggerDefinition & T;

function taskId(event: DomainEvent): number | null {
  const id = event.data.taskId;
  return typeof id === 'number' ? id : null;
}

export const TASK_EVENTS = {
  created: 'helena.task.created',
  assigned: 'helena.task.assigned',
  statusChanged: 'helena.task.status_changed',
  labelsAdded: 'helena.task.labels_added',
} as const;

export const MAIL_RECEIVED = 'helena.mail.received';

const manual: WorkflowTriggerType = { type: 'manual', read: () => ({}) };

const taskCreated: WorkflowTriggerType = {
  type: 'task_created',
  read: () => ({}),
  events: [TASK_EVENTS.created],
  async match(_trigger, event) {
    const id = taskId(event);
    return id === null ? null : { taskId: id };
  },
};

const taskAssigned: WorkflowTriggerType = {
  type: 'task_assigned',
  read: () => ({}),
  events: [TASK_EVENTS.assigned],
  async match(_trigger, event) {
    const id = taskId(event);
    return id === null ? null : { taskId: id };
  },
};

// `to` is a status name; null fires on every change.
const statusChanged: WorkflowTriggerType<Trigger<{ to: string | null }>> = {
  type: 'status_changed',
  read(value, reader) {
    const to = value.to;
    return { to: to === null || to === undefined ? null : reader.text(to, 'to', 120) };
  },
  events: [TASK_EVENTS.statusChanged],
  async match(trigger, event) {
    const id = taskId(event);
    const columnId = event.data.columnId;
    if (id === null || typeof columnId !== 'number') return null;
    if (!trigger.to) return { taskId: id };
    const [column] = await db
      .select({ name: projectColumn.name })
      .from(projectColumn)
      .where(eq(projectColumn.id, columnId));
    return column && same(column.name, trigger.to) ? { taskId: id } : null;
  },
};

const labelAdded: WorkflowTriggerType<Trigger<{ label: string }>> = {
  type: 'label_added',
  read: (value, reader) => ({ label: reader.text(value.label, 'label', 120) }),
  events: [TASK_EVENTS.labelsAdded],
  async match(trigger, event) {
    const id = taskId(event);
    const ids = Array.isArray(event.data.labelIds)
      ? event.data.labelIds.filter((item): item is number => typeof item === 'number')
      : [];
    if (id === null || ids.length === 0) return null;
    const names = await db.select({ name: label.name }).from(label).where(inArray(label.id, ids));
    return names.some((item) => same(item.name, trigger.label)) ? { taskId: id } : null;
  },
};

// Every fire creates a task with `title` and runs the workflow on it.
const schedule: WorkflowTriggerType<Trigger<{ cron: string; timezone: string; title: string }>> = {
  type: 'schedule',
  read(value, reader) {
    const cron = reader.text(value.cron, 'cron', 120);
    const timezone = reader.text(value.timezone, 'timezone', 80);
    const title = reader.text(value.title, 'title', 300);
    if (cron && timezone) {
      try {
        minCronIntervalSeconds(cron, timezone);
      } catch (error) {
        const zone = error instanceof Error && /zone/i.test(error.message);
        reader.issue(zone ? 'invalid_timezone' : 'invalid_cron', zone ? 'timezone' : 'cron');
      }
    }
    return { cron, timezone, title };
  },
  schedule: (trigger) => ({ cron: trigger.cron, timezone: trigger.timezone }),
};

// Every accepted request to the workflow's hook creates a task and runs the workflow.
const webhook: WorkflowTriggerType<Trigger<{ title: string }>> = {
  type: 'webhook',
  read: (value, reader) => ({ title: reader.text(value.title, 'title', 300) }),
};

// Every new mail of the project's accounts that matches creates a task with its subject.
const mailReceived: WorkflowTriggerType<Trigger<{ from: string; subject: string }>> = {
  type: 'mail_received',
  read: (value, reader) => ({
    from: reader.text(value.from ?? '', 'from', 320, false),
    subject: reader.text(value.subject ?? '', 'subject', 200, false),
  }),
  events: [MAIL_RECEIVED],
  async match(trigger, event) {
    const from = typeof event.data.from === 'string' ? event.data.from : '';
    const subject = typeof event.data.subject === 'string' ? event.data.subject : '';
    if (trigger.from && !from.toLowerCase().includes(trigger.from.toLowerCase())) return null;
    if (trigger.subject && !subject.toLowerCase().includes(trigger.subject.toLowerCase()))
      return null;
    const snippet = typeof event.data.snippet === 'string' ? event.data.snippet : '';
    return {
      taskId: null,
      input: {
        task: {
          title: (subject || '(no subject)').slice(0, 300),
          description: [`From: ${from}`, snippet].filter(Boolean).join('\n\n'),
        },
        mail: {
          from,
          subject,
          threadId: event.data.threadId ?? null,
          messageId: event.data.messageId ?? null,
        },
      },
    };
  },
};

const delegation: WorkflowTriggerType = { type: 'delegation', read: () => ({}) };
const routine: WorkflowTriggerType = { type: 'routine', read: () => ({}) };

export const BUILTIN_TRIGGERS: WorkflowTriggerType[] = [
  manual,
  taskCreated,
  taskAssigned,
  statusChanged as unknown as WorkflowTriggerType,
  labelAdded as unknown as WorkflowTriggerType,
  schedule as unknown as WorkflowTriggerType,
  webhook as unknown as WorkflowTriggerType,
  mailReceived as unknown as WorkflowTriggerType,
  delegation,
  routine,
];
