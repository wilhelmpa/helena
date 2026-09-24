import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SERVER_ID = 'KINGSTN-SERVERA-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF';
export const MAC_ID = 'MACBOOK-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG';
export const PHONE_ID = 'IPHONEA-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG';
export const QR_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const KEY = 'test-syncthing-key-0123456789abcdef0123456789';
export const syncthingKeyFile = join(mkdtempSync(join(tmpdir(), 'plan-syncthing-')), 'key');
writeFileSync(syncthingKeyFile, KEY, { mode: 0o600 });

interface BrowseEntry {
  name: string;
  modTime: string;
  size: number;
  type: string;
  children?: BrowseEntry[];
}

function initialState() {
  return {
    devices: [
      { deviceID: SERVER_ID, name: 'kingston-server', paused: false },
      { deviceID: MAC_ID, name: 'MacBook', paused: false },
    ],
    folder: {
      id: 'volition',
      label: 'Helena',
      path: '/srv/volition/vault',
      devices: [{ deviceID: SERVER_ID }, { deviceID: MAC_ID }],
    } as { id: string; label: string; path: string; devices: { deviceID: string }[] } | null,
    pending: {
      [PHONE_ID]: {
        time: '2026-09-23T10:00:00Z',
        name: 'iPhone',
        address: '192.168.2.40:22000',
      },
    } as Record<string, { time: string; name: string; address: string }>,
    connections: {
      [MAC_ID]: { connected: true, address: '192.168.2.30:22000' },
    } as Record<string, { connected: boolean; address: string }>,
    tree: [
      {
        name: 'Home',
        modTime: '2026-09-23T09:00:00Z',
        size: 128,
        type: 'FILE_INFO_TYPE_DIRECTORY',
        children: [
          {
            name: 'Plan.md',
            modTime: '2026-09-23T09:00:00Z',
            size: 10,
            type: 'FILE_INFO_TYPE_FILE',
          },
          {
            name: 'Plan.sync-conflict-20260923-091500-MACBOOK.md',
            modTime: '2026-09-23T09:15:00Z',
            size: 12,
            type: 'FILE_INFO_TYPE_FILE',
          },
        ],
      },
      {
        name: 'README.sync-conflict-20260922-080000-IPHONEA',
        modTime: '2026-09-22T08:00:00Z',
        size: 3,
        type: 'FILE_INFO_TYPE_FILE',
      },
    ] as BrowseEntry[],
  };
}

// A stand-in for Syncthing's REST API that keeps the configuration a test changes.
export const fakeSyncthing = {
  state: initialState(),
  reset() {
    this.state = initialState();
  },
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

async function answer(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const state = fakeSyncthing.state;
  const deviceId = url.pathname.split('/')[4] ?? '';
  switch (route) {
    case 'GET /rest/system/status':
      return json({ myID: SERVER_ID });
    case 'GET /rest/system/version':
      return json({ version: 'v1.29.5' });
    case 'GET /rest/config/options':
      return json({ localAnnounceEnabled: true, globalAnnounceEnabled: true, relaysEnabled: true });
    case 'GET /qr/':
      return url.searchParams.get('text') === SERVER_ID
        ? new Response(QR_PNG, { headers: { 'content-type': 'image/png' } })
        : new Response('wrong text', { status: 400 });
    case 'GET /rest/config/devices':
      return json(state.devices);
    case 'POST /rest/config/devices': {
      const device = (await request.json()) as { deviceID: string; name: string };
      state.devices = [
        ...state.devices.filter((entry) => entry.deviceID !== device.deviceID),
        { paused: false, ...device },
      ];
      delete state.pending[device.deviceID];
      return new Response(null);
    }
    case `GET /rest/config/devices/${deviceId}`: {
      const device = state.devices.find((entry) => entry.deviceID === deviceId);
      return device ? json(device) : new Response('no such device', { status: 404 });
    }
    case `DELETE /rest/config/devices/${deviceId}`:
      state.devices = state.devices.filter((entry) => entry.deviceID !== deviceId);
      if (state.folder) {
        state.folder.devices = state.folder.devices.filter((entry) => entry.deviceID !== deviceId);
      }
      return new Response(null);
    case 'GET /rest/system/connections':
      return json({ connections: state.connections });
    case 'GET /rest/stats/device':
      return json({
        [SERVER_ID]: { lastSeen: '1970-01-01T01:00:00+01:00' },
        [MAC_ID]: { lastSeen: '2026-09-23T11:00:00+02:00' },
      });
    case 'GET /rest/cluster/pending/devices':
      return json(state.pending);
    case 'GET /rest/config/folders/volition':
      return state.folder ? json(state.folder) : new Response('no such folder', { status: 404 });
    case 'PATCH /rest/config/folders/volition':
      if (!state.folder) return new Response('no such folder', { status: 404 });
      Object.assign(state.folder, await request.json());
      return new Response(null);
    case 'GET /rest/db/status':
      return json({
        state: 'idle',
        stateChanged: '2026-09-23T11:05:00+02:00',
        error: '',
        needTotalItems: 0,
        pullErrors: 1,
      });
    case 'GET /rest/stats/folder':
      return json({
        volition: {
          lastScan: '2026-09-23T11:04:00+02:00',
          lastFile: { at: '0001-01-01T00:00:00Z', filename: '' },
        },
      });
    case 'GET /rest/folder/errors':
      return json({ errors: [{ path: 'Home/locked.md', error: 'permission denied' }] });
    case 'GET /rest/db/browse':
      return state.folder ? json(state.tree) : new Response('no such folder', { status: 500 });
    default:
      return new Response(`unexpected ${route}`, { status: 500 });
  }
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    if (request.headers.get('x-api-key') !== KEY) return new Response('Forbidden', { status: 403 });
    return answer(request);
  },
});
server.unref();

export const syncthingUrl = `http://127.0.0.1:${server.port}`;
process.env.SYNCTHING_URL = syncthingUrl;
process.env.SYNCTHING_API_KEY_FILE = syncthingKeyFile;
