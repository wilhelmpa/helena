import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod, requireUser } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import {
  PluginParams,
  PluginSettingsBody,
  PluginsOverviewResponse,
  UiSlotsResponse,
} from './model';
import {
  approvePlugin,
  pluginUiFile,
  pluginsOverview,
  revokePlugin,
  setExternalPluginsEnabled,
  uiSlotDescriptors,
} from './service';

// Plugins (@helena/sdk, docs/helena-framework.md). The Administrator lists the built-in and
// the external plugins with what they provide and the permissions they declare, switches
// external plugins on or off, and approves a plugin at its current version and digest.
// Decisions apply on the next start of the API and the worker.
export const pluginAdminRoutes = new Elysia({ name: 'plugins-admin', detail: { tags: ['God'] } })
  .use(authContext)
  .onBeforeHandle(({ user }) => {
    requireGod(user);
  })
  .get('/god/plugins', () => pluginsOverview(), {
    response: { 200: PluginsOverviewResponse, ...errors(401, 403) },
    detail: { summary: 'List the plugins with their provides, permissions and status' },
  })
  .put('/god/plugins', ({ body }) => setExternalPluginsEnabled(body.externalEnabled), {
    body: PluginSettingsBody,
    response: { 200: PluginsOverviewResponse, ...commonErrors },
    detail: { summary: 'Switch external plugins on or off' },
  })
  .post('/god/plugins/:pluginId/approval', ({ params }) => approvePlugin(params.pluginId), {
    params: PluginParams,
    response: { 200: PluginsOverviewResponse, ...commonErrors, ...errors(409) },
    detail: { summary: 'Approve a plugin at its current version and digest' },
  })
  .delete('/god/plugins/:pluginId/approval', ({ params }) => revokePlugin(params.pluginId), {
    params: PluginParams,
    response: { 200: PluginsOverviewResponse, ...commonErrors },
    detail: { summary: 'Withdraw the approval of a plugin' },
  });

// The frame slots of loaded plugins, for every signed-in person: the web app adds them to
// its own slot registry.
export const pluginSlotRoutes = new Elysia({ name: 'plugins-slots', detail: { tags: ['System'] } })
  .use(authContext)
  .get(
    '/plugins/ui-slots',
    ({ user }) => {
      requireUser(user);
      return uiSlotDescriptors();
    },
    {
      response: { 200: UiSlotsResponse, ...errors(401) },
      detail: { summary: 'List the UI slots plugins add to the web app' },
    },
  );

// A plugin's UI page and its assets, shown in a sandboxed frame. Public like the web
// app's own static files: it is code the operator approved, never data.
export const pluginUiRoutes = new Elysia({ name: 'plugins-ui' }).get(
  '/plugins/:pluginId/ui/*',
  ({ params }) => pluginUiFile(params.pluginId, params['*']),
  { detail: { hide: true } },
);
