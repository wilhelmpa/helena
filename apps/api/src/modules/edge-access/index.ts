import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { errors } from '#shared/responses';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import { EdgeAccessPatchBody, EdgeAccessSettingsDto, SecurityStatusDto } from './model';
import { EdgeAccessError } from './providers';
import {
  edgeAccessConfigured,
  edgeEntry,
  getEdgeAccessSettings,
  setEdgeAccessSettings,
  verifyEdgeRequest,
} from './service';
import { securityStatus } from './status';

export { edgeGuard, edgeEntry, EDGE_ENTRY_HEADER } from './service';

const withConfigured = async () => {
  const settings = await getEdgeAccessSettings();
  return { ...settings, configured: edgeAccessConfigured(settings) };
};

// Administrator → Sicherheit: the host audit's result, the owner's factors, and the edge
// sign-in (Cloudflare Access) that guards the tunnel entry. The owner only; a change needs
// the owner's own interactive session, never a key: it decides who may reach the instance
// from the internet.
export const securityRoutes = new Elysia({ name: 'security', detail: { tags: ['God'] } })
  .use(authContext)
  .onBeforeHandle(({ user }) => {
    requireGod(user);
  })
  .get(
    '/god/security/status',
    async ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return securityStatus();
    },
    {
      response: { 200: SecurityStatusDto, ...errors(401, 403) },
      detail: {
        summary: "Read the server's security status",
        description:
          'The last host audit (pass/fail per check, no secrets), whether the owner has a ' +
          'second factor, the terminal step-up policy, the edge sign-in configuration and ' +
          'the number of open owner sessions.',
      },
    },
  )
  .get('/god/security/edge', withConfigured, {
    response: { 200: EdgeAccessSettingsDto, ...errors(401, 403) },
    detail: {
      summary: 'Read the edge sign-in settings',
      description:
        'The identity-aware proxy in front of the tunnel entry (Cloudflare Access): team ' +
        'domain, Application Audience tags and the optional list of allowed identities.',
    },
  })
  .put(
    '/god/security/edge',
    async ({ user, request, body }) => {
      await requireInteractiveOwner(request, requireGod(user).id);
      await setEdgeAccessSettings(body);
      return withConfigured();
    },
    {
      body: EdgeAccessPatchBody,
      response: { 200: EdgeAccessSettingsDto, ...errors(400, 401, 403) },
      detail: {
        summary: 'Change the edge sign-in settings',
        description:
          'Validated before they are saved. Clearing the team domain and the audiences ' +
          'closes the tunnel entry: every request that arrives there is refused.',
      },
    },
  );

// nginx's auth_request target in the tunnel entry (deployment/volition-stack/native/
// cloudflare/nginx-tunnel.conf): 204 when the edge provider signed the request, 403
// otherwise. It answers 403 to a request without the tunnel marker too, so a location that
// points here by mistake from the LAN entry refuses rather than waves through.
export const edgeVerifyRoutes = new Elysia({ name: 'edge-verify' }).get(
  '/auth/verify/edge',
  async ({ request, set, status }) => {
    set.headers['Cache-Control'] = 'no-store';
    if (!edgeEntry(request.headers)) return status(403);
    try {
      const identity = await verifyEdgeRequest(request.headers);
      if (identity.email) set.headers['X-Helena-Edge-Email'] = identity.email;
      return status(204);
    } catch (error) {
      if (error instanceof EdgeAccessError) return status(403);
      throw error;
    }
  },
  {
    detail: {
      summary: 'Check the edge sign-in for the reverse proxy',
      description:
        "204 when the request carries a valid assertion of the configured edge provider " +
        '(Cloudflare Access), 403 otherwise. Used by nginx for the tunnel entry.',
    },
  },
);
