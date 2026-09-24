// Domain events are CloudEvents 1.0 (https://cloudevents.io) in the structured JSON
// format: the envelope every event broker, webhook receiver and serverless platform
// already reads. Helena's own attributes ride as CloudEvents extension attributes
// (lowercase, alphanumeric): `helenateam`, `helenaproject`, `helenaactor`.
//
// The payload (`data`) carries ids and the few fields a consumer needs to decide
// whether it cares. A consumer that needs more reads it through the API. The one
// exception is `snapshot` on issue and comment events (see CoreEventData).

export interface HelenaEvent<Type extends string = string, Data = unknown> {
  specversion: '1.0';
  // Unique per event, a UUID. Consumers deduplicate on it.
  id: string;
  // Where it happened: `/teams/3/projects/12`, `/teams/3`, or `/` for the instance.
  source: string;
  type: Type;
  // RFC 3339.
  time: string;
  // What it is about, relative to the source: `issues/481`, `runs/9021`.
  subject?: string;
  datacontenttype: 'application/json';
  data: Data;
  helenateam?: number;
  helenaproject?: number;
  // `user:<member id>` for a person, `agent:<agent id>` for an agent, `system`, or
  // `plugin:<plugin id>`.
  helenaactor?: string;
}

export interface IssueRef {
  issueId: number;
  // The issue's key, `VOL-42`.
  identifier: string;
  projectId: number;
}

// The core events Helena emits. Plugins emit their own under their plugin id
// (`<pluginId>.<name>`); the core names are reserved.
//
// `snapshot` is the resource as the API returns it, carried by the issue and comment
// events for consumers that forward it as it is (outgoing webhooks). Decide on the ids
// and fields, and read anything else through the API.
export interface CoreEventData {
  'helena.issue.created': IssueRef & { title: string; parentId: number | null; snapshot?: unknown };
  // The fields that changed, by name (status, priority, labels, …), where known.
  'helena.issue.updated': IssueRef & { changes?: string[]; snapshot?: unknown };
  // Member ids: agents are members too. A delegate is the agent an issue is handed to
  // while a person stays the assignee.
  'helena.issue.assigned': IssueRef & {
    field: 'assignee' | 'delegate';
    assigneeId: string | null;
    previousAssigneeId: string | null;
    snapshot?: unknown;
  };
  'helena.issue.state_changed': IssueRef & { snapshot?: unknown };
  'helena.issue.label_changed': IssueRef & { snapshot?: unknown };
  'helena.issue.link_changed': IssueRef & { snapshot?: unknown };
  'helena.issue.deleted': IssueRef & { snapshot?: unknown };
  'helena.comment.created': CommentRef & { snapshot?: unknown };
  'helena.comment.updated': CommentRef & { snapshot?: unknown };
  'helena.comment.deleted': CommentRef & { snapshot?: unknown };
  'helena.run.started': RunEventData;
  'helena.run.finished': RunEventData;
  'helena.run.failed': RunEventData & { error: string | null };
  'helena.approval.requested': ApprovalEventData;
  'helena.approval.decided': ApprovalEventData & {
    decision: 'approved' | 'rejected';
    decidedBy: string | null;
  };
  // A person's message, and an agent's answer once it is complete (status success or
  // failed).
  'helena.chat.message': {
    threadId: string;
    messageId: number;
    role: 'user' | 'assistant';
    status: 'success' | 'failed';
    agentId: number;
    userId: string | null;
    projectId: number | null;
  };
  // A routine (a schedule that hands an agent a task) created or reopened its task.
  'helena.routine.fired': {
    // Null where the scheduler does not name the routine.
    routineId: string | null;
    // Unique per firing: the scheduler's idempotency key.
    fireId: string;
    agentId: number | null;
    projectId: number;
    // The task, `task:<KEY>-<n>`.
    taskRef: string;
    // A new task, or an existing one reopened.
    mode: 'new' | 'reopen';
  };
}

export interface CommentRef {
  commentId: number;
  issueId: number;
  projectId: number;
}

export interface RunEventData {
  runId: number;
  agentId: number;
  issueId: number | null;
  projectId: number | null;
  trigger: string | null;
}

export interface ApprovalEventData {
  approvalId: number;
  kind: string;
  projectId: number | null;
  agentId: number | null;
  issueId: number | null;
  runId: number | null;
}

export type CoreEventType = keyof CoreEventData;

export const CORE_EVENT_TYPES = [
  'helena.issue.created',
  'helena.issue.updated',
  'helena.issue.assigned',
  'helena.issue.state_changed',
  'helena.issue.label_changed',
  'helena.issue.link_changed',
  'helena.issue.deleted',
  'helena.comment.created',
  'helena.comment.updated',
  'helena.comment.deleted',
  'helena.run.started',
  'helena.run.finished',
  'helena.run.failed',
  'helena.approval.requested',
  'helena.approval.decided',
  'helena.chat.message',
  'helena.routine.fired',
] as const satisfies readonly CoreEventType[];

export type CoreEvent<T extends CoreEventType = CoreEventType> = HelenaEvent<T, CoreEventData[T]>;

export interface EventInit<Type extends string = string, Data = unknown> {
  type: Type;
  data: Data;
  subject?: string;
  teamId?: number | null;
  projectId?: number | null;
  actor?: string | null;
  // Defaults to now; set when the event is recorded after the fact.
  time?: Date;
  id?: string;
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export function eventSource(teamId?: number | null, projectId?: number | null): string {
  if (teamId != null && projectId != null) return `/teams/${teamId}/projects/${projectId}`;
  if (teamId != null) return `/teams/${teamId}`;
  if (projectId != null) return `/projects/${projectId}`;
  return '/';
}

export function createEvent<T extends CoreEventType>(
  init: EventInit<T, CoreEventData[T]>,
): CoreEvent<T>;
export function createEvent<T extends string, D>(init: EventInit<T, D>): HelenaEvent<T, D>;
export function createEvent(init: EventInit): HelenaEvent {
  return {
    specversion: '1.0',
    id: init.id ?? uuid(),
    source: eventSource(init.teamId, init.projectId),
    type: init.type,
    time: (init.time ?? new Date()).toISOString(),
    ...(init.subject ? { subject: init.subject } : {}),
    datacontenttype: 'application/json',
    data: init.data,
    ...(init.teamId != null ? { helenateam: init.teamId } : {}),
    ...(init.projectId != null ? { helenaproject: init.projectId } : {}),
    ...(init.actor ? { helenaactor: init.actor } : {}),
  };
}

// `helena.issue.*` matches every issue event, `*` every event, anything else only itself.
export function matchesEventPattern(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export type EventHandler<E extends HelenaEvent = HelenaEvent> = (event: E) => unknown;

// A consumer that must not miss an event (a webhook, a workflow trigger) subscribes
// durably: it runs in the worker off the outbox, with retries, after the change that
// raised the event committed. An in-process subscriber runs right away in the process
// that published, best effort, for things like refreshing a cache.
export interface EventSubscription {
  // Stable across restarts: the outbox tracks delivery per consumer id.
  id: string;
  patterns: string[];
  handler: EventHandler;
  durable: boolean;
  pluginId: string;
}

export interface EventBus {
  publish(event: HelenaEvent): Promise<void>;
  subscribe(
    patterns: string | string[],
    handler: EventHandler,
    options?: { id?: string; durable?: boolean; pluginId?: string },
  ): () => void;
  subscriptions(): EventSubscription[];
}

export interface EventBusOptions {
  // Where published events are stored for durable consumers: the outbox. Without one,
  // durable subscribers are called in process like the others.
  sink?: (events: HelenaEvent[]) => Promise<void>;
  onError?: (error: unknown, subscription: EventSubscription, event: HelenaEvent) => void;
}

// The process-local bus. publish() hands the event to the sink (the outbox) first, then
// to the in-process subscribers. It never throws for a failing subscriber.
export function createEventBus(options: EventBusOptions = {}): EventBus {
  const subs = new Map<string, EventSubscription>();
  let counter = 0;
  return {
    async publish(event) {
      if (options.sink) await options.sink([event]);
      for (const sub of subs.values()) {
        if (options.sink && sub.durable) continue;
        if (!sub.patterns.some((pattern) => matchesEventPattern(pattern, event.type))) continue;
        try {
          await sub.handler(event);
        } catch (error) {
          if (options.onError) options.onError(error, sub, event);
          else console.error(`[events] subscriber ${sub.id} failed on ${event.type}:`, error);
        }
      }
    },
    subscribe(patterns, handler, opts = {}) {
      const id = opts.id ?? `anonymous-${++counter}`;
      if (subs.has(id)) throw new Error(`Duplicate event subscriber "${id}"`);
      const sub: EventSubscription = {
        id,
        patterns: Array.isArray(patterns) ? patterns : [patterns],
        handler,
        durable: opts.durable ?? false,
        pluginId: opts.pluginId ?? 'helena.core',
      };
      subs.set(id, sub);
      return () => {
        if (subs.get(id) === sub) subs.delete(id);
      };
    },
    subscriptions() {
      return [...subs.values()];
    },
  };
}
