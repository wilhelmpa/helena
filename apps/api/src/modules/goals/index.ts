import { Elysia } from 'elysia';
import { mcpTool } from '#mcp/generate';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { entityGuard, guards } from '#shared/guards';
import { commonErrors } from '#shared/responses';
import { getIssueProjectId } from '#modules/issues/service';
import { issueWhy, projectWhyChains } from '#modules/project-goals/ladder';
import { IssueWhyResponse, ProjectWhyChainsResponse } from '#modules/project-goals/model';
import { HttpError } from '#shared/lib';
import {
  GoalDetailResponse,
  GoalNoteResponse,
  GoalSummaryResponse,
  IssueGoalResponse,
  addGoalNoteBody,
  decideGoalNoteBody,
  goalNoteParams,
  goalParams,
  goalTeamParams,
  issueGoalParams,
  listGoalsQuery,
  setIssueGoalBody,
} from './model';
import { t } from 'elysia';
import { addGoalNote, decideGoalNote, getGoal, listGoals, setIssueGoal } from './service';

// The goals as agents and people work with them (docs/helena-decisions/agent-context.md §7):
// read the goals that concern you, link the tasks that serve one, report progress. Creating
// and editing goals stays on the organization page (modules/organization), for the team's
// owners and managers, who also decide the status an agent proposes.
export const goalRoutes = new Elysia({ name: 'goals', detail: { tags: ['Goals'] } })
  .use(authContext)
  .use(guards)
  .macro({
    workItem: entityGuard('work_items', 'Issue not found', (p) =>
      getIssueProjectId(Number(p.issueId)),
    ),
  })
  .get('/projects/:projectKey/why-chains', ({ project }) => projectWhyChains(project.id), {
    permission: ['work_items', 'read'],
    response: { 200: ProjectWhyChainsResponse, ...commonErrors },
    detail: { summary: 'Read goal chains for the project organigram' },
  })
  .get(
    '/issues/:issueId/why',
    async ({ params }) => {
      const why = await issueWhy(params.issueId);
      if (!why) throw new HttpError(404, 'Issue not found');
      return why;
    },
    {
      params: issueGoalParams,
      workItem: 'read',
      response: { 200: IssueWhyResponse, ...commonErrors },
      detail: {
        summary: 'Get the goal chain behind a task',
        ...mcpTool('get_issue_why'),
      },
    },
  )
  .get(
    '/teams/:teamId/goals',
    ({ membership, query }) =>
      listGoals({ teamId: membership.teamId, userId: membership.userId }, query),
    {
      params: goalTeamParams,
      query: listGoalsQuery,
      teamMember: true,
      response: { 200: t.Array(GoalSummaryResponse), ...commonErrors },
      detail: {
        summary: 'List goals',
        description:
          'The goals you may read: an agent sees the goals of its projects, of their ' +
          'departments and of the whole team, with the goals above them; a person sees all ' +
          'of the team. Active goals by default. Each comes with its chain (path), its ' +
          'project or department, and its progress from the linked tasks.',
        ...mcpTool('list_goals'),
      },
    },
  )
  .get(
    '/teams/:teamId/goals/:goalId',
    ({ membership, params }) =>
      getGoal({ teamId: membership.teamId, userId: membership.userId }, params.goalId),
    {
      params: goalParams,
      teamMember: true,
      response: { 200: GoalDetailResponse, ...commonErrors },
      detail: {
        summary: 'Get a goal',
        description:
          'One goal with its chain, the goals below it, its linked tasks (state, who works ' +
          'on them) and its latest notes and status proposals.',
        ...mcpTool('get_goal'),
      },
    },
  )
  .post(
    '/teams/:teamId/goals/:goalId/notes',
    async ({ membership, params, body, set }) => {
      set.status = 201;
      return addGoalNote(
        { teamId: membership.teamId, userId: membership.userId },
        params.goalId,
        body,
      );
    },
    {
      params: goalParams,
      body: addGoalNoteBody,
      teamMember: true,
      response: { 201: GoalNoteResponse, ...commonErrors },
      detail: {
        summary: 'Add a note to a goal',
        description:
          'Report progress on a goal you may read: what moved it forward, what is next, what ' +
          'blocks it. An agent may propose a new status with proposedStatus (achieved when ' +
          "the goal is reached); the team's owner or manager confirms it, and until then the " +
          'goal keeps its status.',
        ...mcpTool('add_goal_note', undefined, 'report'),
      },
    },
  )
  .post(
    '/teams/:teamId/goals/:goalId/notes/:noteId/decision',
    ({ membership, params, body }) =>
      decideGoalNote(
        membership.teamId,
        params.goalId,
        params.noteId,
        body.accept,
        membership.userId,
      ),
    {
      params: goalNoteParams,
      body: decideGoalNoteBody,
      teamManager: true,
      response: { 200: GoalNoteResponse, ...commonErrors },
      detail: {
        summary: 'Decide a proposed goal status',
        description:
          "Accept or reject an agent's proposed status of a goal. Accepting sets it. Team " +
          'owners and managers only.',
      },
    },
  )
  .put(
    '/issues/:issueId/goal',
    ({ params, body, user }) =>
      setIssueGoal({ userId: requireUser(user).id }, params.issueId, body.goalId),
    {
      params: issueGoalParams,
      body: setIssueGoalBody,
      workItem: 'edit',
      response: { 200: IssueGoalResponse, ...commonErrors },
      detail: {
        summary: 'Link a task to a goal',
        description:
          'Set the goal a task serves (at most one), or unlink it with goalId null. The goal ' +
          'has to be one you may read (list_goals); it then counts the task in its progress.',
        ...mcpTool('link_issue_to_goal'),
      },
    },
  );
