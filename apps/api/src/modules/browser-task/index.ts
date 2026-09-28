import { Elysia, t } from 'elysia';
import { db, integrationCredential } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireGod, requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import {
  BrowserControlResponse,
  ConnectionTestResponse,
  ConnectionsResponse,
  DecisionBackendsResponse,
  InstanceBrowserControlResponse,
  LabOptionsResponse,
  LabRun,
  LabRunsResponse,
  browserTaskProjectParams,
  connectionTestParams,
  labListQuery,
  labRunParams,
  startLabRunBody,
  updateBrowserControlBody,
  updateInstanceBrowserControlBody,
} from './model';
import { decisionBackends } from './backends';
import { loadConnection, testConnection } from './connection';
import {
  effectiveBrowserControl,
  getInstanceBrowserControl,
  getProjectBrowserControl,
  setInstanceBrowserControl,
  setProjectBrowserControl,
} from './settings';
import {
  cancelLabRun,
  getLabRun,
  labAgents,
  labConnections,
  listLabRuns,
  startLabRun,
  type LabScope,
} from './lab';
import { projectSlug, HOME_SLUG } from '#shared/agent-socket';

// "Browser-Steuerung" and Browser 2.0 (docs/helena-decisions/browser-task.md §3.3, §3.5): a
// project's choice between the agents' own step-by-step browsing and a decision model, the
// instance default, the kinds of decision service, "Verbindung testen", and the test area.

async function controlView(project: { id: number; teamId: number }) {
  const [setting, effective] = await Promise.all([
    getProjectBrowserControl(project.id),
    effectiveBrowserControl({ teamId: project.teamId, projectId: project.id }),
  ]);
  return {
    setting,
    effective: {
      enabled: effective.enabled,
      source: effective.source,
      label: effective.label,
      policy: effective.policy,
      credentialId: effective.connection?.credentialId ?? null,
      problem: effective.problem,
    },
  };
}

async function labOptions(scope: LabScope) {
  const [agents, connections, control] = await Promise.all([
    labAgents(scope),
    labConnections(scope),
    effectiveBrowserControl({ teamId: scope.teamId, projectId: scope.project?.id ?? null }),
  ]);
  return {
    agents,
    connections,
    defaultConnectionId: control.connection?.credentialId ?? connections[0]?.id ?? null,
    controlEnabled: control.enabled,
    slug: scope.project ? projectSlug(scope.project.key) : HOME_SLUG,
  };
}

function projectScope(project: { id: number; key: string; teamId: number }): LabScope {
  return { teamId: project.teamId, project: { id: project.id, key: project.key } };
}

export const browserTaskRoutes = new Elysia({
  name: 'browser-task',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/decision-backends',
    ({ user }) => {
      requireUser(user);
      return {
        backends: decisionBackends().map((backend) => ({
          id: backend.id,
          label: backend.label,
          location: backend.location,
          defaultBaseUrl: backend.defaultBaseUrl,
          defaultModel: backend.defaultModel,
          policy: backend.policy,
          protocol: backend.protocol ?? 'systemone',
          keyRequired: backend.keyRequired,
          signupUrl: backend.signupUrl ?? null,
          presets: (backend.presets ?? []).map((preset) => ({
            id: preset.id,
            label: preset.label,
            baseUrl: preset.baseUrl,
            model: preset.model,
            allowPrivateAddress: preset.allowPrivateAddress === true,
            keySource: preset.keySource ?? null,
            modelServer: preset.modelServer ?? null,
          })),
        })),
      };
    },
    {
      response: { 200: DecisionBackendsResponse, ...errors(401) },
      detail: {
        summary: 'List the kinds of decision model service',
        description:
          'The System One services a decision model connection can name (TypeSafe Jev, the ' +
          'Vercel AI Gateway, a Jev-compatible server), with their defaults.',
      },
    },
  )
  .post(
    '/teams/:teamId/credentials/:credentialId/test',
    async ({ params, membership }) => {
      const connection = await loadConnection(params.credentialId);
      if (!connection || connection.teamId !== membership.teamId) {
        throw new HttpError(404, 'Credential not found');
      }
      const result = await testConnection(connection);
      await db
        .update(integrationCredential)
        .set({
          status: result.ok ? 'ok' : 'error',
          statusDetail: result.ok
            ? result.models.slice(0, 5).join(', ') || null
            : result.message.slice(0, 300),
          checkedAt: new Date(),
        })
        .where(
          and(
            eq(integrationCredential.id, connection.credentialId),
            eq(integrationCredential.teamId, membership.teamId),
          ),
        );
      return result;
    },
    {
      params: connectionTestParams,
      teamManager: true,
      response: { 200: ConnectionTestResponse, ...commonErrors },
      detail: {
        summary: 'Test a decision model connection',
        description:
          "Asks the service's model list (or one yes/no question) with the stored key, and " +
          'stores the result as the connection status. The key is never returned.',
      },
    },
  )
  .get('/projects/:projectKey/settings/browser-control', ({ project }) => controlView(project), {
    params: browserTaskProjectParams,
    permission: ['ai_agents', 'read'],
    response: { 200: BrowserControlResponse, ...accessErrors },
    detail: { summary: "Get a project's browser control (Standard or a decision model)" },
  })
  .put(
    '/projects/:projectKey/settings/browser-control',
    async ({ project, body }) => {
      await setProjectBrowserControl(project, body);
      return controlView(project);
    },
    {
      params: browserTaskProjectParams,
      body: updateBrowserControlBody,
      permission: ['ai_agents', 'edit'],
      response: { 200: BrowserControlResponse, ...commonErrors },
      detail: { summary: "Set a project's browser control" },
    },
  )
  .get(
    '/projects/:projectKey/browser-control/connections',
    async ({ project }) => ({ connections: await labConnections(projectScope(project)) }),
    {
      params: browserTaskProjectParams,
      permission: ['ai_agents', 'read'],
      response: { 200: ConnectionsResponse, ...accessErrors },
      detail: { summary: 'List the decision model connections a project can use' },
    },
  )
  .get(
    '/god/browser-control',
    async ({ user }) => {
      requireGod(user);
      return getInstanceBrowserControl();
    },
    {
      response: { 200: InstanceBrowserControlResponse, ...errors(401, 403) },
      detail: { summary: 'Get the instance default browser control' },
    },
  )
  .put(
    '/god/browser-control',
    async ({ user, body }) => {
      requireGod(user);
      return setInstanceBrowserControl(body);
    },
    {
      body: updateInstanceBrowserControlBody,
      response: { 200: InstanceBrowserControlResponse, ...commonErrors },
      detail: { summary: 'Set the instance default browser control' },
    },
  )
  .get(
    '/teams/:teamId/browser-control/connections',
    async ({ membership }) => ({
      connections: await labConnections({ teamId: membership.teamId, project: null }),
    }),
    {
      params: t.Object({ teamId: t.Numeric() }),
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ConnectionsResponse, ...accessErrors },
      detail: { summary: "List a team's decision model connections for the whole team" },
    },
  )
  // Browser 2.0 in a project.
  .get(
    '/projects/:projectKey/browser-lab/options',
    ({ project }) => labOptions(projectScope(project)),
    {
      params: browserTaskProjectParams,
      permission: ['ai_agents', 'edit'],
      response: { 200: LabOptionsResponse, ...accessErrors },
      detail: { summary: 'What a Browser 2.0 test can run as and with' },
    },
  )
  .get(
    '/projects/:projectKey/browser-lab/runs',
    async ({ project, query }) => ({
      runs: await listLabRuns(projectScope(project), Number(query.limit ?? 30)),
    }),
    {
      params: browserTaskProjectParams,
      query: labListQuery,
      permission: ['ai_agents', 'edit'],
      response: { 200: LabRunsResponse, ...accessErrors },
      detail: { summary: "List a project's browser tasks and Browser 2.0 runs" },
    },
  )
  .post(
    '/projects/:projectKey/browser-lab/runs',
    ({ project, body, user }) => startLabRun(requireUser(user), projectScope(project), body),
    {
      params: browserTaskProjectParams,
      body: startLabRunBody,
      permission: ['ai_agents', 'edit'],
      response: { 200: LabRun, ...commonErrors },
      detail: { summary: 'Start a Browser 2.0 run' },
    },
  )
  .get(
    '/projects/:projectKey/browser-lab/runs/:runId',
    ({ project, params }) => getLabRun(projectScope(project), params.runId),
    {
      params: labRunParams,
      permission: ['ai_agents', 'edit'],
      response: { 200: LabRun, ...accessErrors },
      detail: { summary: 'Get a Browser 2.0 run with its steps' },
    },
  )
  .post(
    '/projects/:projectKey/browser-lab/runs/:runId/cancel',
    ({ project, params }) => cancelLabRun(projectScope(project), params.runId),
    {
      params: labRunParams,
      permission: ['ai_agents', 'edit'],
      response: { 200: LabRun, ...commonErrors },
      detail: { summary: 'Cancel a Browser 2.0 run' },
    },
  )
  // Browser 2.0 on Home's own browser (the Home-Master's).
  .get(
    '/teams/:teamId/browser-lab/home/options',
    ({ membership }) => labOptions({ teamId: membership.teamId, project: null }),
    {
      params: t.Object({ teamId: t.Numeric() }),
      teamManager: true,
      response: { 200: LabOptionsResponse, ...accessErrors },
      detail: { summary: "What a Browser 2.0 test on Home's browser can run as and with" },
    },
  )
  .get(
    '/teams/:teamId/browser-lab/home/runs',
    async ({ membership, query }) => ({
      runs: await listLabRuns(
        { teamId: membership.teamId, project: null },
        Number(query.limit ?? 30),
      ),
    }),
    {
      params: t.Object({ teamId: t.Numeric() }),
      query: labListQuery,
      teamManager: true,
      response: { 200: LabRunsResponse, ...accessErrors },
      detail: { summary: "List the browser tasks and Browser 2.0 runs of Home's browser" },
    },
  )
  .post(
    '/teams/:teamId/browser-lab/home/runs',
    ({ membership, body, user }) =>
      startLabRun(requireUser(user), { teamId: membership.teamId, project: null }, body),
    {
      params: t.Object({ teamId: t.Numeric() }),
      body: startLabRunBody,
      teamManager: true,
      response: { 200: LabRun, ...commonErrors },
      detail: { summary: "Start a Browser 2.0 run on Home's browser" },
    },
  )
  .get(
    '/teams/:teamId/browser-lab/home/runs/:runId',
    ({ membership, params }) =>
      getLabRun({ teamId: membership.teamId, project: null }, params.runId),
    {
      params: t.Object({ teamId: t.Numeric(), runId: t.Numeric() }),
      teamManager: true,
      response: { 200: LabRun, ...accessErrors },
      detail: { summary: "Get a Browser 2.0 run on Home's browser" },
    },
  )
  .post(
    '/teams/:teamId/browser-lab/home/runs/:runId/cancel',
    ({ membership, params }) =>
      cancelLabRun({ teamId: membership.teamId, project: null }, params.runId),
    {
      params: t.Object({ teamId: t.Numeric(), runId: t.Numeric() }),
      teamManager: true,
      response: { 200: LabRun, ...commonErrors },
      detail: { summary: "Cancel a Browser 2.0 run on Home's browser" },
    },
  );
