import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { runnerAuth } from '../runner-auth';
import { mcpTool } from '#mcp/generate';
import { agentForPerson } from '../people-access';
import {
  ContinueRunResponse,
  RunDetailResponse,
  RunEventPageResponse,
  RunEventsAckResponse,
  agentRunParams,
  continueRunBody,
  runEventsBody,
  runEventsQuery,
  runEventsRunnerParams,
  runEventsRunnerQuery,
  reportOutputBody,
  ReportOutputResponse,
} from './model';
import { appendRunEvents, continueRun, getRunDetail, listRunEvents } from './service';
import { reportRunOutput } from './outputs';
import { maskForTeam } from '../credentials/env';

// A run as a timeline: the runner sends what the command writes while it runs, a person
// reads it live and afterwards, and can continue the run's session with a new instruction.
export const runTimelineRoutes = new Elysia({
  name: 'agent-run-timeline',
  detail: { tags: ['Agent Runs'] },
})
  .use(authContext)
  .use(guards)
  .use(runnerAuth)

  .post(
    '/agent-runs/:runId/events',
    async ({ agent, params, query, body }) => {
      const events = await maskForTeam(agent.teamId, body.events);
      const ack = await appendRunEvents(agent.id, params.runId, query.claim, events);
      if (!ack) throw new HttpError(404, 'Run not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runEventsRunnerParams,
      query: runEventsRunnerQuery,
      body: runEventsBody,
      response: { 200: RunEventsAckResponse, ...commonErrors },
      detail: {
        summary: 'Report the events of a run',
        description:
          "What the run's command wrote, as AG-UI events, redacted by the runner. Answers " +
          'like a heartbeat whether the command is to stop.',
      },
    },
  )

  .post(
    '/agent-runs/:runId/outputs',
    async ({ agent, params, body, request }) =>
      reportRunOutput(
        agent.id,
        params.runId,
        await maskForTeam(agent.teamId, body),
        request.headers,
      ),
    {
      runnerAgent: true,
      params: runEventsRunnerParams,
      body: reportOutputBody,
      response: { 200: ReportOutputResponse, ...commonErrors, ...errors(400) },
      detail: {
        summary: 'Report a run output',
        description:
          'Attach one result to your active run: a file path, preview URL, pull request URL, or screenshot path or URL. The run ID is in ITSAPLAN_RUN_ID.',
        ...mcpTool('report_output'),
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runs/:runId',
    async ({ params, membership }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      const run = await getRunDetail(params.agentId, params.runId, projectIds);
      if (!run) throw new HttpError(404, 'Run not found');
      return run;
    },
    {
      params: agentRunParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RunDetailResponse, ...commonErrors },
      detail: {
        'x-access': 'agent-inspector',
        summary: 'Read one run of an agent',
        description:
          'The run with its task, result, session, and what it spent per model. Home and authorized owner delegates may inspect within their team.',
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runs/:runId/events',
    async ({ params, membership, query }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      if (!(await getRunDetail(params.agentId, params.runId, projectIds))) {
        throw new HttpError(404, 'Run not found');
      }
      return listRunEvents(params.runId, query.after ?? 0, query.limit ?? 500);
    },
    {
      params: agentRunParams,
      query: runEventsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RunEventPageResponse, ...commonErrors },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Read a run's timeline",
        description:
          'The AG-UI events of the run in order; pass the `next` of a page as `after` to read ' +
          'what arrived since while the run runs.',
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/runs/:runId/continue',
    async ({ params, membership, body, set }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      set.status = 201;
      return {
        runId: await continueRun(params.agentId, params.runId, body.instruction, projectIds),
      };
    },
    {
      params: agentRunParams,
      body: continueRunBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 201: ContinueRunResponse, ...commonErrors, ...errors(409) },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Continue a run's session",
        description:
          "Queue a new run of the agent that resumes the finished run's session with the " +
          'given instruction.',
      },
    },
  );
