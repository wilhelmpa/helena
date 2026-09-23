import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import {
  MAC_ID,
  PHONE_ID,
  QR_PNG,
  SERVER_ID,
  fakeSyncthing,
  syncthingKeyFile,
  syncthingUrl,
} from '#tests/helpers/syncthing';

const ORIGIN = { origin: 'http://localhost:3001' };

async function owner() {
  const user = await signUpTestUser();
  return { read: authedApi(user.cookie), write: authedApi(user.cookie, ORIGIN), user };
}

describe('device sync', () => {
  beforeEach(async () => {
    await resetDb();
    fakeSyncthing.reset();
  });

  afterEach(() => {
    process.env.SYNCTHING_URL = syncthingUrl;
    process.env.SYNCTHING_API_KEY_FILE = syncthingKeyFile;
  });

  it('reports this server, the folder, the devices and the pending requests', async () => {
    const { read } = await owner();
    const { status, data } = await read['device-sync'].get();
    expect(status).toBe(200);
    expect(data).toMatchObject({
      state: 'ready',
      server: {
        deviceId: SERVER_ID,
        qrCode: `data:image/png;base64,${Buffer.from(QR_PNG).toString('base64')}`,
        version: 'v1.29.5',
        lanAddress: null,
        localDiscovery: true,
        globalDiscovery: true,
        relays: true,
      },
      folder: {
        label: 'Volition',
        path: '/srv/volition/vault',
        state: 'idle',
        lastFileAt: null,
        lastFileName: null,
        error: null,
        fileErrorCount: 1,
        fileErrors: [{ path: 'Home/locked.md', error: 'permission denied' }],
      },
      devices: [
        {
          deviceId: MAC_ID,
          name: 'MacBook',
          connected: true,
          address: '192.168.2.30:22000',
          sharesFolder: true,
        },
      ],
      pendingDevices: [{ deviceId: PHONE_ID, name: 'iPhone', address: '192.168.2.40:22000' }],
    });
    expect(new Date(data!.folder!.lastScanAt!).toISOString()).toBe('2026-09-23T09:04:00.000Z');
    expect(new Date(data!.devices[0]!.lastSeenAt!).toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });

  it('names the LAN address devices add for this server', async () => {
    process.env.SYNCTHING_LAN_ADDRESS = 'tcp://192.168.2.220:22000';
    try {
      const { read } = await owner();
      const { data } = await read['device-sync'].get();
      expect(data?.server?.lanAddress).toBe('tcp://192.168.2.220:22000');
    } finally {
      delete process.env.SYNCTHING_LAN_ADDRESS;
    }
  });

  it('says when Syncthing is not set up', async () => {
    const { read, write } = await owner();
    process.env.SYNCTHING_API_KEY_FILE = '/nonexistent/syncthing_api_key';
    const missing = await read['device-sync'].get();
    expect(missing.status).toBe(200);
    expect(missing.data).toMatchObject({ state: 'unconfigured', server: null, devices: [] });
    expect((await write['device-sync'].pending({ deviceId: PHONE_ID }).accept.post()).status).toBe(
      503,
    );
  });

  it('says when Syncthing refuses the key', async () => {
    const { read } = await owner();
    const wrongKey = `${syncthingKeyFile}.wrong`;
    writeFileSync(wrongKey, 'another-key-0123456789abcdef0123456789abcdef', { mode: 0o600 });
    process.env.SYNCTHING_API_KEY_FILE = wrongKey;
    const { data } = await read['device-sync'].get();
    expect(data?.state).toBe('unconfigured');
  });

  it('says when Syncthing does not answer', async () => {
    const { read, write } = await owner();
    const closed = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    process.env.SYNCTHING_URL = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    const { data } = await read['device-sync'].get();
    expect(data).toMatchObject({ state: 'unreachable', server: null, folder: null });
    const removed = await write['device-sync'].devices({ deviceId: MAC_ID }).delete();
    expect(removed.status).toBe(503);
    expect(removed.error?.value).toMatchObject({ error: 'Syncthing is not reachable' });
    expect((await read['device-sync'].conflicts.get()).status).toBe(503);
  });

  it('accepts a pending device and shares the vault folder with it', async () => {
    const { read, write } = await owner();
    const accepted = await write['device-sync'].pending({ deviceId: PHONE_ID }).accept.post();
    expect(accepted.status).toBe(204);
    const { data } = await read['device-sync'].get();
    expect(data?.pendingDevices).toEqual([]);
    expect(data?.devices).toContainEqual(
      expect.objectContaining({ deviceId: PHONE_ID, name: 'iPhone', sharesFolder: true }),
    );
    expect(fakeSyncthing.state.folder?.devices.map((device) => device.deviceID)).toEqual([
      SERVER_ID,
      MAC_ID,
      PHONE_ID,
    ]);
  });

  it('accepts only a device that asked, into a folder that exists', async () => {
    const { write } = await owner();
    const unknown = await write['device-sync'].pending({ deviceId: MAC_ID }).accept.post();
    expect(unknown.status).toBe(404);
    const invalid = await write['device-sync'].pending({ deviceId: 'not-a-device' }).accept.post();
    expect(invalid.status).toBe(400);
    fakeSyncthing.state.folder = null;
    const noFolder = await write['device-sync'].pending({ deviceId: PHONE_ID }).accept.post();
    expect(noFolder.status).toBe(409);
    expect(fakeSyncthing.state.devices.map((device) => device.deviceID)).not.toContain(PHONE_ID);
  });

  it('removes a device from the sync', async () => {
    const { read, write } = await owner();
    expect((await write['device-sync'].devices({ deviceId: MAC_ID }).delete()).status).toBe(204);
    const { data } = await read['device-sync'].get();
    expect(data?.devices).toEqual([]);
    expect(fakeSyncthing.state.folder?.devices).toEqual([{ deviceID: SERVER_ID }]);
    expect((await write['device-sync'].devices({ deviceId: MAC_ID }).delete()).status).toBe(404);
    expect((await write['device-sync'].devices({ deviceId: SERVER_ID }).delete()).status).toBe(400);
  });

  it('lists the conflict copies with the file each belongs to', async () => {
    const { read } = await owner();
    const { status, data } = await read['device-sync'].conflicts.get();
    expect(status).toBe(200);
    const items = data!.items.map((item) => ({
      ...item,
      modifiedAt: new Date(item.modifiedAt).toISOString(),
    }));
    expect(items).toEqual([
      {
        path: 'Home/Plan.sync-conflict-20260923-091500-MACBOOK.md',
        originalPath: 'Home/Plan.md',
        modifiedAt: '2026-09-23T09:15:00.000Z',
        size: 12,
      },
      {
        path: 'README.sync-conflict-20260922-080000-IPHONEA',
        originalPath: 'README',
        modifiedAt: '2026-09-22T08:00:00.000Z',
        size: 3,
      },
    ]);
  });

  it("is the owner's signed-in browser only", async () => {
    const first = await owner();
    const member = await signUpTestUser();
    expect((await authedApi(member.cookie)['device-sync'].get()).status).toBe(403);
    const key = await auth.api.createApiKey({ body: { userId: first.user.userId, name: 'agent' } });
    expect((await apiKeyApi(key.key)['device-sync'].get()).status).toBe(403);
    const withoutOrigin = await first.read['device-sync']
      .pending({ deviceId: PHONE_ID })
      .accept.post();
    expect(withoutOrigin.status).toBe(403);
    expect(fakeSyncthing.state.pending[PHONE_ID]).toBeDefined();
  });
});
