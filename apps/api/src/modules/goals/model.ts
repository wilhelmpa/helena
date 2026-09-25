import { t } from 'elysia';

export const goalStatus = t.Union([
  t.Literal('planned'),
  t.Literal('active'),
  t.Literal('achieved'),
  t.Literal('paused'),
]);

export const goalTeamParams = t.Object({ teamId: t.Numeric() });
export const goalParams = t.Object({ teamId: t.Numeric(), goalId: t.Numeric() });
export const goalNoteParams = t.Object({
  teamId: t.Numeric(),
  goalId: t.Numeric(),
  noteId: t.Numeric(),
});
export const issueGoalParams = t.Object({ issueId: t.Numeric() });

export const listGoalsQuery = t.Object({
  status: t.Optional(
    t.Union([goalStatus, t.Literal('all')], {
      description: 'Which goals: active (the default), planned, achieved, paused, or all.',
    }),
  ),
  projectKey: t.Optional(
    t.String({ description: "Only the goals of this project (its key, e.g. 'VOL')." }),
  ),
});

export const setIssueGoalBody = t.Object({
  goalId: t.Nullable(
    t.Integer({
      minimum: 1,
      description: 'The goal the task serves (from list_goals), or null to unlink it.',
    }),
  ),
});

export const addGoalNoteBody = t.Object({
  body: t.String({
    minLength: 1,
    maxLength: 4000,
    description: 'What changed: progress, what is done, what is next, what blocks it.',
  }),
  proposedStatus: t.Optional(
    t.Nullable(
      t.Union([goalStatus], {
        description:
          "A new status to propose (achieved, paused …). The goal's owner confirms it; " +
          'until then the goal keeps its status.',
      }),
    ),
  ),
});

export const decideGoalNoteBody = t.Object({ accept: t.Boolean() });

const goalRef = t.Object({ id: t.Number(), key: t.String(), name: t.String() });
const agentRef = t.Object({ id: t.Number(), username: t.String(), name: t.String() });
const personRef = t.Object({
  name: t.String(),
  username: t.Nullable(t.String()),
  agent: t.Boolean(),
});

export const GoalProgressResponse = t.Object({
  total: t.Number({ description: 'Linked tasks that are not canceled.' }),
  done: t.Number({ description: 'Linked tasks in a completed state.' }),
  agents: t.Array(agentRef, { description: "The agents working on the goal's open tasks." }),
});

export const GoalSummaryResponse = t.Object({
  id: t.Number(),
  title: t.String(),
  description: t.String(),
  status: goalStatus,
  targetDate: t.Nullable(t.String()),
  parentGoalId: t.Nullable(t.Number()),
  path: t.Array(t.String(), { description: 'The titles of the goals above it, outermost first.' }),
  project: t.Nullable(goalRef),
  department: t.Nullable(t.Object({ id: t.Number(), name: t.String() })),
  progress: GoalProgressResponse,
  updatedAt: t.String(),
});

export const GoalNoteResponse = t.Object({
  id: t.Number(),
  body: t.String(),
  author: t.Nullable(personRef),
  proposedStatus: t.Nullable(goalStatus),
  decision: t.Nullable(t.Union([t.Literal('accepted'), t.Literal('rejected')])),
  decidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const GoalDetailResponse = t.Composite([
  GoalSummaryResponse,
  t.Object({
    children: t.Array(t.Object({ id: t.Number(), title: t.String(), status: goalStatus })),
    tasks: t.Array(
      t.Object({
        issueId: t.Number(),
        identifier: t.String(),
        title: t.String(),
        stateType: t.String(),
        stateName: t.String(),
        assignee: t.Nullable(personRef),
        running: t.Boolean(),
      }),
    ),
    notes: t.Array(GoalNoteResponse),
  }),
]);

export const IssueGoalResponse = t.Object({
  issueId: t.Number(),
  goalId: t.Nullable(t.Number()),
});
