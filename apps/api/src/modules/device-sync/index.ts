import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import { ConflictListResponse, DeviceIdParams, DeviceSyncStatusResponse } from './model';
import { acceptDevice, deviceSyncStatus, listConflicts, removeDevice } from './service';

// The Syncthing service on this server that syncs the vault with the owner's devices.
// A device that is accepted receives the whole vault, Private/ included, so only the
// owner's signed-in browser may use these routes, never an API key.
export const deviceSyncRoutes = new Elysia({
  name: 'device-sync',
  detail: { tags: ['Device sync'] },
})
  .use(authContext)
  .onBeforeHandle(async ({ user, request }) => {
    const owner = requireGod(user);
    await requireInteractiveOwner(request, owner.id);
  })
  .get(
    '/device-sync',
    ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return deviceSyncStatus();
    },
    {
      response: { 200: DeviceSyncStatusResponse, ...errors(401, 403, 502) },
      detail: {
        summary: 'Read the Syncthing status of the vault',
        description:
          "This server's device ID, the vault folder, the devices and their pending requests. " +
          'A Syncthing that is not set up or does not answer is reported in `state`.',
      },
    },
  )
  .get('/device-sync/conflicts', () => listConflicts(), {
    response: { 200: ConflictListResponse, ...errors(401, 403, 502, 503) },
    detail: {
      summary: 'List the sync conflict copies in the vault',
      description:
        'Every file Syncthing kept as the older copy of a conflict, with the path of the file it belongs to.',
    },
  })
  .post(
    '/device-sync/pending/:deviceId/accept',
    async ({ params }) => {
      await acceptDevice(params.deviceId);
      return noContent();
    },
    {
      params: DeviceIdParams,
      response: { 204: t.Void(), ...commonErrors, ...errors(409, 502, 503) },
      detail: {
        summary: 'Accept a device and share the vault folder with it',
        description:
          'Adds a device that asked to connect and shares the folder Helena with it. The device then offers the folder to its owner.',
      },
    },
  )
  .delete(
    '/device-sync/devices/:deviceId',
    async ({ params }) => {
      await removeDevice(params.deviceId);
      return noContent();
    },
    {
      params: DeviceIdParams,
      response: { 204: t.Void(), ...commonErrors, ...errors(502, 503) },
      detail: {
        summary: 'Remove a device from the sync',
        description:
          'Removes the device from Syncthing and from the folders shared with it. The files on the device stay.',
      },
    },
  );
