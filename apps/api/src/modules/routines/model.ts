import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';
import { oneOf } from '#shared/schemas';

export const AutomationHealthResponse = t.Object({
  checkedAt: t.String(),
  offlineAgents: t.Array(
    t.Object({ id: t.Number(), name: t.String(), lastSeenAt: t.Nullable(t.String()) }),
  ),
  runs: t.Array(
    t.Object({
      id: t.Number(),
      agentId: t.Number(),
      issueId: t.Nullable(t.Number()),
      status: t.String(),
      createdAt: t.String(),
      finishedAt: t.Nullable(t.String()),
      hasError: t.Boolean(),
    }),
  ),
  truncated: t.Boolean(),
});

export const routineParams = t.Object({
  projectKey: t.String(),
  routineId: t.String({
    pattern: '^[A-Za-z0-9_-]{1,200}$',
    description: 'Routine id from list_routines.',
  }),
});

// A union of literals: t.UnionEnum defaults to its first value, which would fill in a
// mode an update leaves out.
export const routineMode = t.Union([t.Literal('new'), t.Literal('reopen')], {
  description: "'new' creates a task on every run; 'reopen' reopens the task named by taskId.",
});

const routineFields = {
  agentId: t.Number({ description: 'Agent from list_ai_agents the task is delegated to.' }),
  title: t.String({
    minLength: 1,
    maxLength: 300,
    description: 'Name of the routine and title of the tasks it creates.',
  }),
  instructions: t.String({
    minLength: 1,
    maxLength: 20_000,
    description:
      'Description of a created task, or the comment on a reopened one. An @mention of an ' +
      'agent of the project starts that agent on the task as well, on every run, the way a ' +
      'mention in a comment does; the mentions count as yours.',
  }),
  mode: routineMode,
  taskId: t.Optional(
    t.Nullable(t.Number({ description: "Numeric id of the issue a 'reopen' routine reopens." })),
  ),
  cron: t.String({
    minLength: 1,
    maxLength: 120,
    description: "Five-field cron expression, e.g. '0 9 * * 1' for Mondays at 09:00.",
  }),
  timezone: t.Optional(
    t.String({
      minLength: 1,
      maxLength: 80,
      description:
        "IANA time zone the cron runs in. Default: the instance's time zone (Administrator).",
    }),
  ),
  catchUp: t.Optional(
    t.Union([t.Literal('skip'), t.Literal('once')], {
      description:
        "What a run the engine missed while it was down does: 'skip' (default) records it as " +
        "missed, 'once' runs the newest missed one once.",
    }),
  ),
  gateMode: t.Optional(t.Union([t.Literal('off'), t.Literal('shadow'), t.Literal('active')])),
  gateSource: t.Optional(t.Union([t.Literal('none'), t.Literal('mail'), t.Literal('audit')])),
};

export const createRoutineBody = t.Object(
  {
    idempotencyKey: t.String({
      format: 'uuid',
      description: 'Creates nothing new when a routine with this key exists already.',
    }),
    ...routineFields,
  },
  { additionalProperties: false },
);

export const updateRoutineBody = t.Partial(
  t.Object({
    ...routineFields,
    enabled: t.Boolean({ description: 'Whether the routine runs on its cron.' }),
  }),
  { additionalProperties: false },
);

export const routinePageQuery = t.Object(pageQueryFields);

// Why a mention starts no run of an agent (MentionRefusal).
const mentionReason = oneOf(
  ['not-in-project', 'agent-author', 'owner-only', 'mentions-off', 'paused'],
  {
    description:
      "'not-in-project': the agent does not work in this project; 'agent-author': an " +
      "agent saved the routine, and an agent's mentions start nobody; 'owner-only': the " +
      "agent takes work from its owner only; 'mentions-off': it does not react to mentions; " +
      "'paused': it is paused.",
  },
);

export const RoutineMentionResponse = t.Object({
  agent: t.Object({ id: t.Number(), name: t.String(), username: t.String() }),
  starts: t.Boolean({ description: 'Whether a run of the routine starts the agent.' }),
  reason: t.Nullable(mentionReason),
});

export const mentionPreviewBody = t.Object(
  {
    instructions: t.String({ maxLength: 20_000 }),
    agentId: t.Optional(
      t.Nullable(t.Number({ description: "The routine's own agent, which is left out." })),
    ),
  },
  { additionalProperties: false },
);

// A routine DTO (RoutineRow from the service).
export const RoutineResponse = t.Object({
  id: t.String(),
  projectKey: t.String(),
  projectName: t.String(),
  agent: t.Nullable(
    t.Object(
      { id: t.Number(), name: t.String() },
      { description: 'Null when it left the project.' },
    ),
  ),
  title: t.String(),
  instructions: t.String(),
  mentions: t.Array(RoutineMentionResponse, {
    description:
      "The agents the instructions @mention besides the routine's own, and whether a run " +
      'starts each, for the member the routine acts for.',
  }),
  mode: routineMode,
  task: t.Nullable(
    t.Object(
      { id: t.Number(), number: t.Number(), title: t.String() },
      {
        description: "The issue a 'reopen' routine reopens.",
      },
    ),
  ),
  cron: t.String(),
  timezone: t.String(),
  catchUp: t.Union([t.Literal('skip'), t.Literal('once')]),
  gateMode: t.Union([t.Literal('off'), t.Literal('shadow'), t.Literal('active')]),
  gateSource: t.Union([t.Literal('none'), t.Literal('mail'), t.Literal('audit')]),
  enabled: t.Boolean(),
  nextRunAt: t.Nullable(t.String()),
  lastRun: t.Nullable(
    t.Object({
      id: t.String({ description: 'The run, as get_workflow_run reads it.' }),
      status: t.String({
        description:
          "The run: 'pending', 'running', 'succeeded', 'skipped', 'failed' or 'canceled'.",
      }),
      outcome: t.Nullable(oneOf(['created', 'reopened', 'skipped'])),
      skipReason: t.Nullable(
        oneOf(['task-open', 'missed', 'gate'], {
          description:
            "'task-open': the routine's task was still open; 'missed': the run started too late.",
        }),
      ),
      gate: t.Nullable(
        t.Object({
          mode: t.Union([t.Literal('off'), t.Literal('shadow'), t.Literal('active')]),
          source: t.Union([t.Literal('none'), t.Literal('mail'), t.Literal('audit')]),
          recommendation: t.Union([t.Literal('run'), t.Literal('skip')]),
          reason: t.String(),
          counts: t.Record(t.String(), t.Number()),
          decisionId: t.Nullable(t.Number()),
          confidence: t.Nullable(t.Number()),
          status: t.String(),
        }),
      ),
      taskNumber: t.Nullable(
        t.Number({ description: 'The task the run created, reopened or kept.' }),
      ),
      error: t.Nullable(t.String()),
      firedAt: t.Nullable(t.String()),
    }),
  ),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const RoutinePageResponse = pageResponse(RoutineResponse);
