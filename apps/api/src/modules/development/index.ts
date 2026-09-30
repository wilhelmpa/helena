import { Elysia } from 'elysia';
import { rootOwner } from '#modules/root-access/service';
import { developmentOperation } from './service';
import { configureDevelopmentProject } from './project';
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
  developmentOperationBody,
  developmentJobParams,
  DevelopmentJobResponse,
  developmentQueueBody,
  DevelopmentQueueResponse,
  developmentMaxBody,
  DevelopmentMaxResponse,
  developmentProjectBody,
  DevelopmentProjectResponse,
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
    ({ developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentStatusResponse>>('DevelopmentStatus', {
        actor: `agent:${developmentAgent.id}`,
      }),
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
    ({ params, developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentReportResponse>>('DevelopmentReport', {
        ...params,
        actor: `agent:${developmentAgent.id}`,
      }),
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
    ({ developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentReleaseResponse>>('DevelopmentRelease', {
        actor: `agent:${developmentAgent.id}`,
      }),
    {
      developmentHome: true,
      response: { 200: DevelopmentReleaseResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Read the latest gate summaries and live checkout SHA for Home',
        ...mcpTool('get_development_release', undefined, 'read'),
      },
    },
  )
  .post(
    '/agent-development/operations',
    ({ body, developmentAgent }) => {
      const { operation, ...parameters } = body;
      const methods = {
        worktree: 'DevelopmentWorktree',
        merge: 'DevelopmentMerge',
        review: 'DevelopmentReview',
        gate: 'DevelopmentGate',
        tests: 'DevelopmentTests',
        build: 'DevelopmentBuild',
        probe: 'DevelopmentProbe',
        deploy: 'DevelopmentDeploy',
        verify: 'DevelopmentVerify',
      };
      const input =
        operation === 'tests' && 'testFiles' in parameters
          ? { ...parameters, tests: { files: parameters.testFiles }, testFiles: undefined }
          : parameters;
      if ('testFiles' in input) delete input.testFiles;
      return developmentOperation<Static<typeof DevelopmentJobResponse>>(methods[operation], {
        ...input,
        actor: `agent:${developmentAgent.id}`,
      });
    },
    {
      developmentHome: true,
      body: developmentOperationBody,
      response: { 200: DevelopmentJobResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Start a typed Ava development job',
        description:
          'Operations: worktree (target branch/name), merge (target branch), review (evidence), gate, tests (testFiles), build/deploy (pauseHalogen), probe on :3091, verify (smoke and integrity). Every stage binds to branch and full expected SHA. dryRun=true only records a plan, with no subprocess or live mutation. Real build/probe/deploy require successful review and gate; deploy also requires build and probe. Read completion with get_development_job.',
        ...mcpTool('run_development_operation', undefined, 'execute'),
      },
    },
  )
  .get(
    '/agent-development/jobs/:id',
    ({ params, developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentJobResponse>>('DevelopmentJob', {
        ...params,
        actor: `agent:${developmentAgent.id}`,
      }),
    {
      developmentHome: true,
      params: developmentJobParams,
      response: { 200: DevelopmentJobResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Read a development job result and report',
        ...mcpTool('get_development_job', undefined, 'read'),
      },
    },
  )
  .post(
    '/agent-development/tasks/:number/control',
    ({ params, body, developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentQueueResponse>>('DevelopmentQueueControl', {
        ...params,
        ...body,
        actor: `agent:${developmentAgent.id}`,
      }),
    {
      developmentHome: true,
      params: developmentNumberParams,
      body: developmentQueueBody,
      response: { 200: DevelopmentQueueResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Stop or requeue one Codex task',
        ...mcpTool('control_codex_task', undefined, 'execute'),
      },
    },
  )
  .post(
    '/agent-development/queue/maximum',
    ({ body, developmentAgent }) =>
      developmentOperation<Static<typeof DevelopmentMaxResponse>>('DevelopmentMax', {
        ...body,
        actor: `agent:${developmentAgent.id}`,
      }),
    {
      developmentHome: true,
      body: developmentMaxBody,
      response: { 200: DevelopmentMaxResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Set Codex queue concurrency from one to five',
        ...mcpTool('set_codex_maximum', undefined, 'write'),
      },
    },
  )
  .post(
    '/agent-development/project',
    ({ body, developmentAgent }) =>
      configureDevelopmentProject(developmentAgent.id, body.runtime, body.dryRun),
    {
      developmentHome: true,
      body: developmentProjectBody,
      response: { 200: DevelopmentProjectResponse, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: 'Configure HELENA #15 as Ava Entwicklung and select its coordinator runtime',
        description:
          'Reuses the existing project and coordinator, imports ava-entwicklung, assigns Reviewer/Coder and links the canonical handoff as a knowledge document. dryRun=true plans the existing records.',
        ...mcpTool('configure_development_project', undefined, 'write'),
      },
    },
  );
