import { requireInteractiveOwner } from './interactive';
import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import { ConnectionActionBody, ConnectionsResponse } from './model';
import { connectionsAction, connectionsSnapshot } from './service';

export const connectionsRoutes = new Elysia({
  name: 'connections',
  detail: { tags: ['Connections'] },
})
  .use(authContext)
  .onBeforeHandle(async ({ user, request }) => {
    const owner = requireGod(user);
    await requireInteractiveOwner(request, owner.id);
  })
  .get('/connections', () => connectionsSnapshot(), {
    response: { 200: ConnectionsResponse, ...errors(401, 403, 502, 503) },
    detail: { summary: 'List redacted host connections and live health' },
  })
  .post('/connections/actions', ({ body }) => connectionsAction(body), {
    body: ConnectionActionBody,
    response: { 200: ConnectionsResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Probe or reconnect an allowlisted connection' },
  });
