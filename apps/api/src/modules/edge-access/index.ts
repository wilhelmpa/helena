import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { errors } from '#shared/responses';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import {
  EdgeAccessPatchBody,
  EdgeAccessSettingsDto,
  EdgeHomeDto,
  EdgeHomeProbeDto,
  SecurityStatusDto,
  SignInEventDto,
  SignInEventsQuery,
} from './model';
import { EdgeAccessError } from './providers';
import { decodeJwt } from 'jose';
import { lanAccessCookies } from './lan';
import {
  edgeAccessConfigured,
  edgeEntry,
  getEdgeAccessSettings,
  setEdgeAccessSettings,
  verifyEdgeRequest,
} from './service';
// Registers the Cloudflare sign-in's check with packages/auth on import.
import { homeConfig, homeUrl, listSignInEvents } from './sign-in';
import { securityStatus } from './status';

export { edgeGuard, edgeEntry, EDGE_ENTRY_HEADER } from './service';

const withConfigured = async () => {
  const settings = await getEdgeAccessSettings();
  const token = process.env.HELENA_EDGE_ENTRY_TOKEN;
  return {
    ...settings,
    homeUrl: homeUrl(),
    entryProof: Boolean(token && token.length >= 32),
    configured: edgeAccessConfigured(settings),
  };
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
    async ({ body }) => {
      await setEdgeAccessSettings(body);
      return withConfigured();
    },
    {
      body: EdgeAccessPatchBody,
      beforeHandle: ({ user, request }) => requireInteractiveOwner(request, requireGod(user).id),
      response: { 200: EdgeAccessSettingsDto, ...errors(400, 401, 403) },
      detail: {
        summary: 'Change the edge sign-in settings',
        description:
          'Validated before they are saved. Clearing the team domain and the audiences ' +
          'closes the tunnel entry: every request that arrives there is refused. The ' +
          'Cloudflare sign-in (`signIn`) needs the provider set up and at least one allowed ' +
          'identity.',
      },
    },
  )
  .get(
    '/god/security/sign-ins',
    async ({ query, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return listSignInEvents(query.limit ?? 20, query.method);
    },
    {
      query: SignInEventsQuery,
      response: { 200: t.Array(SignInEventDto), ...errors(401, 403) },
      detail: {
        summary: 'List the password-less sign-ins',
        description:
          'The newest sign-ins Helena opened without a password: through the Cloudflare ' +
          'sign-in (`edge`) and the LAN owner sign-in (`local_owner`), refused ones included, ' +
          'with the identity, the client address and the browser.',
      },
    },
  );

// The home network's own origin (HELENA_HOME_URL, served by nginx on the LAN directly). The
// web app on the public name asks whether to switch there, and checks with the probe that it
// is at home: the probe answers only where the home name leads to this machine. Public on
// purpose: neither says more than the home name, which is in public DNS anyway.
export const edgeHomeRoutes = new Elysia({ name: 'edge-home', detail: { tags: ['System'] } })
  .get(
    '/edge/home',
    async ({ set }) => {
      set.headers['Cache-Control'] = 'no-store';
      return homeConfig();
    },
    {
      response: { 200: EdgeHomeDto },
      detail: {
        summary: 'Get the home network origin',
        description:
          'The origin the home network reaches this instance on directly, and whether the web ' +
          'app switches to it by itself at home.',
      },
    },
  )
  .get(
    '/edge/home/probe',
    ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store';
      // Through the tunnel this is not the home network, whatever the Host says.
      const host = (request.headers.get('host') ?? '').toLowerCase();
      return { home: !edgeEntry(request.headers), host };
    },
    {
      response: { 200: EdgeHomeProbeDto },
      detail: {
        summary: 'Answer the home network probe',
        description:
          "The web app's check that the home origin answers from this device: `home` is true " +
          'unless the request came through the internet tunnel.',
      },
    },
  );

// nginx's auth_request target in the tunnel entry (deployment/volition-stack/native/
// cloudflare/nginx-tunnel.conf): 204 when the edge provider signed the request, 403
// otherwise. It answers 403 to a request without the tunnel marker too, so a location that
// points here by mistake from the LAN entry refuses rather than waves through.
export const edgeVerifyRoutes = new Elysia({ name: 'edge-verify' })
  .get(
    '/auth/verify/edge',
    async ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store';
      if (edgeEntry(request.headers) !== 'tunnel')
        throw new HttpError(403, 'Tunnel entry required');
      try {
        const identity = await verifyEdgeRequest(request.headers);
        if (identity.email) set.headers['X-Helena-Edge-Email'] = identity.email;
        return noContent();
      } catch (error) {
        if (error instanceof EdgeAccessError) {
          throw new HttpError(403, 'Edge assertion refused', `edge_${error.code}`);
        }
        throw error;
      }
    },
    {
      response: { 204: t.Void(), ...errors(403) },
      detail: {
        summary: 'Check the edge sign-in for the reverse proxy',
        description:
          '204 when the request carries a valid assertion of the configured edge provider ' +
          '(Cloudflare Access), 403 otherwise. Used by nginx for the tunnel entry.',
      },
    },
  )
  .get(
    '/auth/verify/lan',
    ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store';
      // The API-wide guard already checked the cookie JWT and the public Access path.
      if (edgeEntry(request.headers) !== 'lan') throw new HttpError(403, 'LAN entry required');
      // A browser timer closes all streams by reloading at the verified token's exp.
      // decodeJwt is safe here because edgeGuard has already verified this exact cookie.
      const expiresAt = decodeJwt(lanAccessCookies(request.headers.get('cookie')).assertion).exp;
      if (expiresAt) set.headers['X-Helena-Access-Expires'] = String(expiresAt);
      return noContent();
    },
    {
      response: { 204: t.Void(), ...errors(403) },
      detail: {
        summary: 'Check the edge sign-in for the home network entry',
        description:
          '204 when a request that entered through the home network carries a valid edge assertion; ' +
          'reports the assertion expiry in X-Helena-Access-Expires. 403 otherwise.',
      },
    },
  );

// Mounts the Administrator routes on the assembled app after its chain, like mountMcp: a typed
// .use() here would push the app's type past TypeScript's instantiation limit (TS2589), and
// nothing calls these routes through Eden. They carry their own session guard.
export function mountSecurityRoutes(app: { use: (plugin: unknown) => unknown }): void {
  app.use(securityRoutes);
  app.use(edgeHomeRoutes);
}
