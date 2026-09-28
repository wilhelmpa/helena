import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod, requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { commonErrors, errors } from '#shared/responses';
import {
  ExtensionConnectionSchema,
  ExtensionProjectsResponse,
  ProjectExtensionBody,
  ProjectExtensionParams,
  ProjectExtensionsResponse,
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
import { extensionProjects, projectExtensions, updateProjectExtension } from './project-extensions';

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
    detail: {
      summary: 'List the plugins with their provides, permissions and status',
      description:
        'The built-in plugins and those found in the plugin folder, each with what it provides, the permissions it declares, its digest, whether it is approved and whether a restart is needed.',
    },
  })
  .get('/god/plugins/projects', () => extensionProjects(), {
    response: { 200: ExtensionProjectsResponse, ...errors(401, 403) },
    detail: {
      summary: 'List the projects each plugin has settings in',
      description:
        "By plugin id, the projects with a connection of one of the plugin's connectors (Projekt › Einstellungen › Erweiterungen).",
    },
  })
  .put('/god/plugins', ({ body }) => setExternalPluginsEnabled(body.externalEnabled), {
    body: PluginSettingsBody,
    response: { 200: PluginsOverviewResponse, ...commonErrors },
    detail: {
      summary: 'Switch external plugins on or off',
      description:
        'External plugins load at the next start of the API and the worker when this is on.',
    },
  })
  .post('/god/plugins/:pluginId/approval', ({ params }) => approvePlugin(params.pluginId), {
    params: PluginParams,
    response: { 200: PluginsOverviewResponse, ...commonErrors, ...errors(409) },
    detail: {
      summary: 'Approve a plugin at its current version and digest',
      description:
        'Records the plugin id, version and sha256 digest as they are on disk now; a changed plugin needs a new approval.',
    },
  })
  .delete('/god/plugins/:pluginId/approval', ({ params }) => revokePlugin(params.pluginId), {
    params: PluginParams,
    response: { 200: PluginsOverviewResponse, ...commonErrors },
    detail: {
      summary: 'Withdraw the approval of a plugin',
      description: 'The plugin no longer loads from the next start on.',
    },
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
      detail: {
        summary: 'List the UI slots plugins add to the web app',
        description:
          'The frame slots of loaded plugins (panel tools, settings sections, …), for the web app to add to its own slot registry.',
      },
    },
  );

// A plugin's UI page and its assets, shown in a sandboxed frame. Public like the web
// app's own static files: it is code the operator approved, never data.
export const pluginUiRoutes = new Elysia({ name: 'plugins-ui' }).get(
  '/plugins/:pluginId/ui/*',
  ({ params }) => pluginUiFile(params.pluginId, params['*']),
  { detail: { hide: true } },
);

// A project's extensions (Projekt › Einstellungen › Erweiterungen): what a plugin brings for
// this project, from its connectors' fields. For the project's owners and the team's owners
// and managers, like the project's other settings. Secrets never leave the store: a secret
// field only says whether it is set, and cannot be changed here.
export const projectExtensionRoutes = new Elysia({
  name: 'project-extensions',
  detail: { tags: ['Projects'] },
})
  .use(authContext)
  .use(guards)
  .get('/projects/:projectKey/extensions', ({ project }) => projectExtensions(project), {
    projectAdmin: true,
    response: { 200: ProjectExtensionsResponse, ...commonErrors },
    detail: {
      summary: "List the project's extension settings",
      description:
        "The plugins with a connection in this project, each with its connectors' fields and the project's connections: non-secret values as stored, secret fields only as set or not.",
    },
  })
  .patch(
    '/projects/:projectKey/extensions/connections/:credentialId',
    ({ project, params, body }) =>
      updateProjectExtension(project, params.credentialId, body.values),
    {
      projectAdmin: true,
      params: ProjectExtensionParams,
      body: ProjectExtensionBody,
      response: { 200: ExtensionConnectionSchema, ...commonErrors },
      detail: {
        summary: "Save a project connection's settings",
        description:
          'Saves non-secret fields of a connection of this project; fields left out keep their value. A secret field is refused (it changes in Zugänge).',
      },
    },
  );
