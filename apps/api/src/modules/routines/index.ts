import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { noContent } from '#shared/http';
import { paginate } from '#shared/pagination';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import {
  createRoutineBody,
  RoutinePageResponse,
  routinePageQuery,
  routineParams,
  RoutineResponse,
  updateRoutineBody,
} from './model';
import {
  createRoutine,
  deleteRoutine,
  listMemberRoutines,
  listProjectRoutines,
  listRoutineRuns,
  runRoutine,
  updateRoutine,
} from './service';
import { PipelineRunPageResponse } from '#modules/pipelines/model';

export const routineRoutes = new Elysia({
  name: 'routines',
  detail: { tags: ['Routines'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/routines',
    ({ user, query }) =>
      paginate(query, (window) => listMemberRoutines(requireUser(user).id, window)),
    {
      query: routinePageQuery,
      response: { 200: RoutinePageResponse, ...errors(400, 401) },
      detail: {
        summary: 'List routines across projects',
        description:
          'One page of the routines of every project whose agents you may read, newest first.',
      },
    },
  )
  .get(
    '/projects/:projectKey/routines',
    ({ project, query }) => paginate(query, (window) => listProjectRoutines(project, window)),
    {
      permission: ['ai_agents', 'read'],
      query: routinePageQuery,
      response: { 200: RoutinePageResponse, ...accessErrors },
      detail: {
        summary: 'List routines',
        description:
          "One page of the project's routines, newest first, with their cron, next run and " +
          'last run.',
        ...mcpTool('list_routines'),
      },
    },
  )
  .post(
    '/projects/:projectKey/routines',
    async ({ project, body, set, user }) => {
      const routine = await createRoutine(project, requireUser(user).id, body);
      set.status = 201;
      return routine;
    },
    {
      body: createRoutineBody,
      permission: ['ai_agents', 'create'],
      response: { 201: RoutineResponse, ...commonErrors },
      detail: {
        summary: 'Create a routine',
        description:
          'Create a routine that, on a cron, creates a task delegated to an agent or reopens ' +
          'a task. A run is skipped while the task of the routine is still open.',
        ...mcpTool('create_routine'),
      },
    },
  )
  .patch(
    '/projects/:projectKey/routines/:routineId',
    ({ project, params, body, user }) =>
      updateRoutine(project, requireUser(user).id, params.routineId, body),
    {
      params: routineParams,
      body: updateRoutineBody,
      permission: ['ai_agents', 'edit'],
      response: { 200: RoutineResponse, ...commonErrors },
      detail: {
        summary: 'Update a routine',
        description:
          "Change a routine's agent, task, cron or time zone, or switch it on or off. A change " +
          'other than the switch makes you the member its runs act for.',
        ...mcpTool('update_routine'),
      },
    },
  )
  .delete(
    '/projects/:projectKey/routines/:routineId',
    async ({ project, params }) => {
      await deleteRoutine(project, params.routineId);
      return noContent();
    },
    {
      params: routineParams,
      permission: ['ai_agents', 'delete'],
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete a routine',
        description: 'Delete a routine. The tasks it created stay.',
        ...mcpTool('delete_routine'),
      },
    },
  )
  .post(
    '/projects/:projectKey/routines/:routineId/run',
    async ({ project, params, set, user }) => {
      const run = await runRoutine(project, requireUser(user).id, params.routineId);
      set.status = 202;
      return run;
    },
    {
      params: routineParams,
      permission: ['ai_agents', 'edit'],
      response: { 202: t.Object({ runId: t.String() }), ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Run a routine now',
        description:
          'Run the routine once now, outside its cron. It runs in the background; its result ' +
          'is the last run of list_routines.',
        ...mcpTool('run_routine'),
      },
    },
  )
  .get(
    '/projects/:projectKey/routines/:routineId/runs',
    ({ project, params, query }) =>
      paginate(query, (window) => listRoutineRuns(project, params.routineId, window)),
    {
      params: routineParams,
      query: routinePageQuery,
      permission: ['ai_agents', 'read'],
      response: { 200: PipelineRunPageResponse, ...accessErrors },
      detail: {
        summary: 'List the runs of a routine',
        description:
          'One page of the runs of the routine, newest first: when each was due, what it did ' +
          '(created, reopened or skipped a task) and why a failed one failed.',
        ...mcpTool('list_routine_runs'),
      },
    },
  );
