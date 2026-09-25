import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import { teamParams } from '#modules/teams/model';
import { agentScopeOf } from '#modules/agents/core/service';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import { AccessLoginsResponse, accessLoginAgentParams, agentLoginRow } from './model';
import { checkAgentLogin, listAccessLogins, signOutAgentLogin } from './service';

// "Anmeldungen" in Zugänge: the logins of the team's Claude Code and Codex agents (their
// own, or the stored one granted to them) and, for the owner, the model logins every Hermes
// agent shares. Reading needs what reading credentials needs; asking a runner again needs a
// team owner or manager; signing a runtime out is the owner's alone, in the signed-in
// interface. None of these routes is an MCP tool.
export const accessLoginRoutes = new Elysia({
  name: 'access-logins',
  detail: { tags: ['Credentials'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/access/logins',
    ({ membership, user }) =>
      listAccessLogins(membership.teamId, {
        owner: user?.role === 'god',
        visibleTo: agentScopeOf(membership),
      }),
    {
      params: teamParams,
      teamPermission: ['integrations', 'read'],
      response: { 200: AccessLoginsResponse, ...commonErrors },
      detail: {
        summary: "List the agents' logins",
        description:
          'Every Claude Code and Codex agent of the team with the login its runtime works ' +
          "with: its own in its home (a Codex device login; the runtime's account e-mail, " +
          'plan and last renewal, as the runtime told the runner) or a stored runtime login ' +
          'granted to it, and the command that signs it in again. For the owner also the ' +
          'model logins every Hermes agent shares, as the token keeper reports them. Never a ' +
          'token.',
      },
    },
  )

  .post(
    '/teams/:teamId/access/logins/agents/:agentId/check',
    ({ params, membership, user }) =>
      checkAgentLogin(membership.teamId, params.agentId, {
        owner: user?.role === 'god',
        visibleTo: agentScopeOf(membership),
        userId: membership.userId,
      }),
    {
      params: accessLoginAgentParams,
      teamManager: true,
      response: { 200: agentLoginRow, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: "Check an agent's own login now",
        description:
          "Has the agent's runner ask its runtime for its login now (after the owner signed " +
          'it in, say) instead of at its next regular look, and returns the row.',
      },
    },
  )

  .post(
    '/teams/:teamId/access/logins/agents/:agentId/sign-out',
    async ({ params, membership, user, request }) => {
      const owner = requireGod(user);
      await requireInteractiveOwner(request, owner.id);
      return signOutAgentLogin(
        membership.teamId,
        params.agentId,
        { owner: true, visibleTo: agentScopeOf(membership), userId: owner.id },
        owner,
      );
    },
    {
      params: accessLoginAgentParams,
      teamManager: true,
      response: { 200: agentLoginRow, ...commonErrors, ...errors(409, 502, 503, 504) },
      detail: {
        summary: "Sign an agent's own runtime login out",
        description:
          "Has the agent's runner run the runtime's own sign-out (`codex logout`) as the " +
          'user the agent runs as, in its own sandbox; the login file is never read. The ' +
          "owner's signed-in interface only. Written to the access log.",
      },
    },
  );
