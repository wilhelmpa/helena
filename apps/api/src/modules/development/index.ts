import { Elysia } from 'elysia';
import { rootOwner } from '#modules/root-access/service';
import { developmentOperation } from './service';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { HttpError } from '#shared/lib';
import { authContext } from '#shared/auth-context';
import type { Static } from 'elysia';
import { mcpTool } from '#mcp/generate';
import { commonErrors, errors } from '#shared/responses';
import {
  developmentTaskBody,
  developmentNumberParams,
  DevelopmentTaskResponse,
  DevelopmentReportResponse,
  DevelopmentStatusResponse,
  DevelopmentReleaseResponse,
} from './model';

export const developmentRoutes = new Elysia({ name: 'volition-development' })
  .use(authContext)
  .macro({
    developmentHome: {
      async resolve({ user }) {
        const agent = user && (await getRunnerAgent(user.id));
        if (!agent) throw new HttpError(403, 'Only the Home agent may use development tools');
        await rootOwner(agent.id);
        return { developmentAgent: agent };
      },
    },
  })
  .post(
    '/agent-development/tasks',
    ({ body, developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentTaskResponse>>('DevelopmentEnqueue', {
        ...body,
        body: { text: body.body },
        actor: `agent:${developmentAgent.id}`,
      }),
    {
      developmentHome: true,
      body: developmentTaskBody,
      response: { 200: DevelopmentTaskResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Enqueue a Codex development task for Home',
        description:
          'Write a numbered task with model and reasoning headers into the fixed development spool. Example: name api-fix, model gpt-6.1-sol, effort high, body containing the base branch and acceptance criteria.',
        ...mcpTool('enqueue_codex_task', undefined, 'write'),
      },
    },
  )
  .get(
    '/agent-development/status',
    () => developmentOperation<Static<typeof DevelopmentStatusResponse>>('DevelopmentStatus'),
    {
      developmentHome: true,
      response: { 200: DevelopmentStatusResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Read the Codex queue and running tasks for Home',
        ...mcpTool('get_codex_queue', undefined, 'read'),
      },
    },
  )
  .get(
    '/agent-development/reports/:number',
    ({ params }) =>
      developmentOperation<Static<typeof DevelopmentReportResponse>>('DevelopmentReport', params),
    {
      developmentHome: true,
      params: developmentNumberParams,
      response: { 200: DevelopmentReportResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Read a numbered Codex report for Home',
        ...mcpTool('read_codex_report', undefined, 'read'),
      },
    },
  )
  .get(
    '/agent-development/release',
    () => developmentOperation<Static<typeof DevelopmentReleaseResponse>>('DevelopmentRelease'),
    {
      developmentHome: true,
      response: { 200: DevelopmentReleaseResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Read the latest gate summaries and live checkout SHA for Home',
        ...mcpTool('get_development_release', undefined, 'read'),
      },
    },
  );
