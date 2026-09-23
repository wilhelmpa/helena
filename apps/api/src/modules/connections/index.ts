import { requireInteractiveOwner } from './interactive';
import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import {
  SecretInventoryResponse,
  VaultStatusResponse,
  SecretSetBody,
  ConnectionActionBody,
  ConnectionsResponse,
  ThemeSyncBody,
  ThemeSyncResponse,
} from './model';
import {
  secretInventory,
  vaultStatus,
  secretSet,
  connectionsAction,
  connectionsSnapshot,
  syncWorkspaceTheme,
} from './service';

export const connectionsRoutes = new Elysia({
  name: 'connections',
  detail: { tags: ['Connections'] },
})
  .use(authContext)
  .onBeforeHandle(async ({ user, request }) => {
    const owner = requireGod(user);
    await requireInteractiveOwner(request, owner.id);
  })
  .get(
    '/vault/status',
    ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return vaultStatus();
    },
    {
      response: { 200: VaultStatusResponse, ...errors(401, 403) },
      detail: {
        summary: 'Check the human-vault access route',
        description:
          'Report only the protected Vaultwarden access-route status. Backend health and secret values stay outside Plan.',
      },
    },
  )
  .get(
    '/connections/secrets',
    ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return secretInventory();
    },
    {
      response: { 200: SecretInventoryResponse, ...errors(401, 403, 502, 503) },
      detail: {
        summary: 'List configured secrets',
        description:
          'List secret names, update times, and allowed hosts without returning secret values.',
      },
    },
  )
  .post(
    '/connections/secrets',
    ({ body, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return secretSet(body);
    },
    {
      body: SecretSetBody,
      response: { 200: SecretInventoryResponse, ...commonErrors, ...errors(502, 503) },
      detail: {
        summary: 'Set a managed secret',
        description: 'Store a named secret and restrict which allowlisted hosts may receive it.',
      },
    },
  )
  .get('/connections', () => connectionsSnapshot(), {
    response: { 200: ConnectionsResponse, ...errors(401, 403, 502, 503) },
    detail: { summary: 'List redacted host connections and live health' },
  })
  .post('/connections/actions', ({ body }) => connectionsAction(body), {
    body: ConnectionActionBody,
    response: { 200: ConnectionsResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Probe or reconnect an allowlisted connection' },
  })
  .post('/theme/sync', ({ body }) => syncWorkspaceTheme(body), {
    body: ThemeSyncBody,
    response: { 200: ThemeSyncResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Persist the owner theme across connected workspaces' },
  });
