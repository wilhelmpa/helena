import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

export const routineParams = t.Object({
  projectKey: t.String(),
  routineId: t.String({
    pattern: '^[A-Za-z0-9_-]{1,200}$',
    description: 'Routine id from list_routines.',
  }),
});

export const routineMode = t.UnionEnum(['new', 'reopen'], {
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
    description: 'Description of a created task, or the comment on a reopened one.',
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
      description: 'IANA time zone the cron runs in. Default Europe/Berlin.',
    }),
  ),
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
  enabled: t.Boolean(),
  nextRunAt: t.Nullable(t.String()),
  lastRun: t.Nullable(
    t.Object({
      status: t.String({
        description: "The workflow run: 'pending', 'running', 'success', 'failed'.",
      }),
      outcome: t.Nullable(t.UnionEnum(['created', 'reopened', 'skipped'])),
      skipReason: t.Nullable(
        t.UnionEnum(['task-open', 'missed'], {
          description:
            "'task-open': the routine's task was still open; 'missed': the run started too late.",
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
