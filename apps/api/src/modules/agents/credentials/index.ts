import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { paginate } from '#shared/pagination';
import { teamParams } from '#modules/teams/model';
import { runnerAuth } from '../runner-auth';
import {
  CredentialEntryPageResponse,
  CredentialEntryResponse,
  CredentialGrantsResponse,
  CredentialUsePageResponse,
  EnvVariablesResponse,
  EnvironmentResponse,
  SshKeysResponse,
  WebLoginsResponse,
  chatWorkParams,
  createCredentialEntryBody,
  credentialEntryParams,
  credentialListQuery,
  credentialUseListQuery,
  credentialUsesBody,
  environmentQuery,
  runWorkParams,
  setCredentialGrantsBody,
  updateCredentialEntryBody,
} from './model';
import {
  createCredentialEntry,
  deleteCredentialEntry,
  getCredentialEntry,
  listCredentialEntries,
  listCredentialUses,
  regenerateSshKey,
  setCredentialGrants,
  updateCredentialEntry,
} from './service';
import {
  claimedWork,
  deliverSshKeys,
  deliverWebLogins,
  recordWebLoginUses,
  workRefOf,
} from './delivery';
import { recordOwnerChange } from './audit';
import { decisionKeySourceOptions } from './decision-key-source';
import { deliverEnvVariables, listEnvironment } from './env';

function found<T>(entry: T | null): T {
  if (!entry) throw new HttpError(404, 'Credential not found');
  return entry;
}

// The Credentials page: the team's web logins, API keys, SSH keys and secrets. A
// credential gives an agent access to an outside account, so only the team's owners and
// managers change one or grant it, and none of these routes is an MCP tool. The runner
// of an agent reads the logins granted to it for the run or chat answer it holds.
export const credentialRoutes = new Elysia({
  name: 'credentials',
  detail: { tags: ['Credentials'] },
})
  .use(authContext)
  .use(guards)
  .use(runnerAuth)

  .get(
    '/teams/:teamId/credentials',
    ({ membership, query }) =>
      paginate(query, (window) =>
        listCredentialEntries(
          membership.teamId,
          { kind: query.kind, projectId: query.projectId },
          window,
        ),
      ),
    {
      params: teamParams,
      query: credentialListQuery,
      teamPermission: ['integrations', 'read'],
      response: { 200: CredentialEntryPageResponse, ...commonErrors },
      detail: {
        summary: 'List credentials',
        description:
          "One page of the team's web logins, API keys, SSH keys and secrets. Secret fields " +
          'are named in `secrets` when they hold a value; their values are never returned.',
      },
    },
  )

  .get(
    '/teams/:teamId/credentials/decision-key-sources/options',
    async ({ membership, query }) => ({
      items: await decisionKeySourceOptions(membership.teamId, query.projectId ?? null),
    }),
    {
      params: teamParams,
      query: t.Object({ projectId: t.Optional(t.Numeric({ minimum: 1 })) }),
      teamManager: true,
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.Number(),
              label: t.Nullable(t.String()),
              projectId: t.Nullable(t.Number()),
              projectKey: t.Nullable(t.String()),
            }),
          ),
        }),
        ...commonErrors,
      },
      detail: { summary: 'Choose an API key source for a decision connection' },
    },
  )

  .post(
    '/teams/:teamId/credentials',
    async ({ membership, body, set, user }) => {
      set.status = 201;
      const entry = await createCredentialEntry(membership.teamId, body);
      await recordOwnerChange(membership.teamId, entry.id, user, 'created');
      return entry;
    },
    {
      params: teamParams,
      body: createCredentialEntryBody,
      teamManager: true,
      response: { 201: CredentialEntryResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Add a credential',
        description:
          'Store a web login, API key, SSH key or secret. An SSH key is generated: the ' +
          'response carries its public key, the private key is never returned.',
      },
    },
  )

  .patch(
    '/teams/:teamId/credentials/:credentialId',
    async ({ params, membership, body, user }) => {
      const entry = found(
        await updateCredentialEntry(params.credentialId, membership.teamId, body),
      );
      await recordOwnerChange(membership.teamId, params.credentialId, user, 'edited');
      return entry;
    },
    {
      params: credentialEntryParams,
      body: updateCredentialEntryBody,
      teamManager: true,
      response: { 200: CredentialEntryResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Update a credential',
        description:
          'Change a credential. A secret field left out keeps its value, one that is sent ' +
          'replaces it. Moving it to a project removes the grants of agents that do not ' +
          'work there.',
      },
    },
  )

  .delete(
    '/teams/:teamId/credentials/:credentialId',
    async ({ params, membership, user }) => {
      if (!(await deleteCredentialEntry(params.credentialId, membership.teamId, user))) {
        throw new HttpError(404, 'Credential not found');
      }
      return noContent();
    },
    {
      params: credentialEntryParams,
      teamManager: true,
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Delete a credential',
        description: 'Delete a credential. The runners remove a web login at their next run.',
      },
    },
  )

  .put(
    '/teams/:teamId/credentials/:credentialId/grants',
    async ({ params, membership, body, user }) => {
      if ((body.agentIds === undefined) === (body.grants === undefined)) {
        throw new HttpError(400, 'Send either agentIds or grants.');
      }
      const grants = body.grants ?? (body.agentIds ?? []).map((agentId) => ({ agentId }));
      const result = found(
        await setCredentialGrants(params.credentialId, membership.teamId, grants),
      );
      await recordOwnerChange(membership.teamId, params.credentialId, user, 'grants');
      return { grants: result };
    },
    {
      params: credentialEntryParams,
      body: setCredentialGrantsBody,
      teamManager: true,
      response: { 200: CredentialGrantsResponse, ...commonErrors },
      detail: {
        summary: 'Grant a credential',
        description:
          'Replace who may use a credential or connector account: agents, or every agent ' +
          'of a project, optionally for one service and read-only. Every agent has to run ' +
          'in a runner and, for a credential limited to a project, work in that project.',
      },
    },
  )

  .post(
    '/teams/:teamId/credentials/:credentialId/ssh-key',
    async ({ params, membership, user }) => {
      const entry = found(await regenerateSshKey(params.credentialId, membership.teamId));
      await recordOwnerChange(membership.teamId, params.credentialId, user, 'new-key');
      return entry;
    },
    {
      params: credentialEntryParams,
      teamManager: true,
      response: { 200: CredentialEntryResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Generate a new SSH key pair',
        description: 'Replace the key pair of an SSH key. The old public key stops working.',
      },
    },
  )

  .get(
    '/teams/:teamId/agent-environment',
    async ({ membership, query }) => {
      if ((query.agentId === undefined) === (query.projectId === undefined)) {
        throw new HttpError(400, 'Name an agent or a project.');
      }
      return {
        variables: await listEnvironment(
          membership.teamId,
          query.agentId !== undefined
            ? { agentId: query.agentId }
            : { projectId: query.projectId! },
        ),
      };
    },
    {
      params: teamParams,
      query: environmentQuery,
      teamPermission: ['integrations', 'read'],
      response: { 200: EnvironmentResponse, ...commonErrors },
      detail: {
        summary: "List an agent's or a project's environment variables",
        description:
          'The environment variables from Zugänge that reach the runs of an agent, or of the ' +
          "agents of a project: each variable's name, its credential and the grants it comes " +
          'through. Values are never returned.',
      },
    },
  )

  .get(
    '/teams/:teamId/credentials/:credentialId/uses',
    async ({ params, membership, query }) => {
      found(await getCredentialEntry(params.credentialId, membership.teamId));
      return paginate(query, (window) =>
        listCredentialUses(membership.teamId, params.credentialId, window),
      );
    },
    {
      params: credentialEntryParams,
      query: credentialUseListQuery,
      teamPermission: ['integrations', 'read'],
      response: { 200: CredentialUsePageResponse, ...commonErrors },
      detail: {
        summary: "List a credential's audit log",
        description:
          'Every time an agent runner received the credential and every login the agent ' +
          'filled with it, newest first.',
      },
    },
  )

  .get(
    '/agent-runs/:runId/web-logins',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { runId: params.runId });
      return { logins: await deliverWebLogins(agent, work) };
    },
    {
      runnerAgent: true,
      params: runWorkParams,
      response: { 200: WebLoginsResponse, ...commonErrors },
      detail: {
        summary: 'Read the web logins of a claimed run',
        description:
          'The web logins granted to the calling agent that the run may use, for the ' +
          "agent's Hermes vault. Only for a run the caller holds under a live lease.",
      },
    },
  )

  .get(
    '/agent-chats/:messageId/web-logins',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { messageId: params.messageId });
      return { logins: await deliverWebLogins(agent, work) };
    },
    {
      runnerAgent: true,
      params: chatWorkParams,
      response: { 200: WebLoginsResponse, ...commonErrors },
      detail: {
        summary: 'Read the web logins of a claimed chat answer',
        description:
          'The web logins granted to the calling agent, for the chat answer the caller ' +
          'holds under a live lease.',
      },
    },
  )

  .get(
    '/agent-runs/:runId/ssh-keys',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { runId: params.runId });
      return { keys: await deliverSshKeys(agent, work) };
    },
    {
      runnerAgent: true,
      params: runWorkParams,
      response: { 200: SshKeysResponse, ...commonErrors },
      detail: {
        summary: 'Read the SSH keys of a claimed run',
        description:
          'The SSH keys granted to the calling agent (or its project) for git, and the key ' +
          'of a clone job. Only for a run the caller holds under a live lease.',
      },
    },
  )

  .get(
    '/agent-chats/:messageId/ssh-keys',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { messageId: params.messageId });
      return { keys: await deliverSshKeys(agent, work) };
    },
    {
      runnerAgent: true,
      params: chatWorkParams,
      response: { 200: SshKeysResponse, ...commonErrors },
      detail: {
        summary: 'Read the SSH keys of a claimed chat answer',
        description: 'The SSH keys granted to the calling agent, for git.',
      },
    },
  )

  .get(
    '/agent-runs/:runId/env',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { runId: params.runId });
      return { variables: await deliverEnvVariables(agent, work) };
    },
    {
      runnerAgent: true,
      params: runWorkParams,
      response: { 200: EnvVariablesResponse, ...commonErrors },
      detail: {
        summary: 'Read the environment variables of a claimed run',
        description:
          'The API keys, secrets and variables granted to the calling agent (or its ' +
          "project) with an environment variable name, for the run's command. Only for a " +
          'run the caller holds under a live lease; every delivery is in the audit log.',
      },
    },
  )

  .get(
    '/agent-chats/:messageId/env',
    async ({ agent, params, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      const work = await claimedWork(agent.id, { messageId: params.messageId });
      return { variables: await deliverEnvVariables(agent, work) };
    },
    {
      runnerAgent: true,
      params: chatWorkParams,
      response: { 200: EnvVariablesResponse, ...commonErrors },
      detail: {
        summary: 'Read the environment variables of a claimed chat answer',
        description:
          "The environment variables granted to the calling agent, for the chat answer's " +
          "command; the chat's project decides between a team's and a project's credential.",
      },
    },
  )

  .post(
    '/agent-runtime/credential-uses',
    async ({ agent, body }) => {
      const ref = workRefOf(body);
      if (!ref) throw new HttpError(400, 'Name the run or the chat answer.');
      await recordWebLoginUses(agent, await claimedWork(agent.id, ref), body.uses);
      return noContent();
    },
    {
      runnerAgent: true,
      body: credentialUsesBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Record the logins an agent filled',
        description:
          'The web logins the agent filled during a run or chat answer the caller holds, ' +
          'for the audit log.',
      },
    },
  );
