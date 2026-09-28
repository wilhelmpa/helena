import { t } from 'elysia';
import { goalStatus } from '#modules/goals/model';
export const ProjectGoalContext = t.Object({
  goals: t.Array(
    t.Object({
      id: t.Integer(),
      title: t.String(),
      description: t.String(),
      status: goalStatus,
      targetDate: t.Nullable(t.String()),
      parentGoalId: t.Nullable(t.Integer()),
      path: t.Array(t.String()),
      scope: t.Union([t.Literal('project'), t.Literal('department'), t.Literal('team')]),
      progress: t.Nullable(t.Object({ total: t.Integer(), done: t.Integer() })),
    }),
  ),
  links: t.Array(t.Object({ initiativeId: t.Integer(), goalId: t.Integer() })),
});
export const projectGoalLinkBody = t.Object({ goalId: t.Nullable(t.Integer({ minimum: 1 })) });
export const ProjectGoalLink = t.Object({
  initiativeId: t.Integer(),
  goalId: t.Nullable(t.Integer()),
});

const WhyTask = t.Object({ id: t.Integer(), identifier: t.String(), title: t.String() });
export const IssueWhyResponse = t.Object({
  department: t.Nullable(t.Object({ id: t.Integer(), name: t.String() })),
  goal: t.Nullable(t.Object({ id: t.Integer(), title: t.String(), path: t.Array(t.String()) })),
  initiative: t.Nullable(t.Object({ id: t.Integer(), title: t.String() })),
  parents: t.Array(WhyTask),
  task: WhyTask,
  source: t.Nullable(
    t.Union([
      t.Literal('explicit'),
      t.Literal('parent'),
      t.Literal('initiative'),
      t.Literal('project'),
      t.Literal('department'),
      t.Literal('team'),
    ]),
  ),
});

export const ProjectWhyChainsResponse = t.Array(
  t.Object({
    why: IssueWhyResponse,
    agent: t.Nullable(t.Object({ id: t.Integer(), userId: t.String(), name: t.String() })),
  }),
);
