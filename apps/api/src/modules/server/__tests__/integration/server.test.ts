import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi, app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { HostdError, useHostdTransport } from '../../hostd';
import { invalidate } from '../../service';
import { backup, power, storage } from '../fixtures';

// Administrator → Server through a fake host helper: what the owner reads, that every change
// needs his interactive session, and how the helper's answers and errors come out.

const ORIGIN = { origin: (process.env.APP_URL ?? '').split(',')[0]!.trim() };

// The first user of a reset database is the instance owner.
async function setup() {
  const user = await signUpTestUser({ name: 'Root', email: 'root@example.com' });
  return {
    god: {
      cookie: user.cookie,
      api: authedApi(user.cookie),
      interactive: authedApi(user.cookie, ORIGIN),
    },
  };
}

async function apiKeyOf(cookie: string): Promise<string> {
  const response = await app.handle(
    new Request('http://localhost/api/auth/api-key/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...ORIGIN },
      body: JSON.stringify({ name: 'server test' }),
    }),
  );
  return ((await response.json()) as { key: string }).key;
}

interface Call {
  method: string;
  parameters: Record<string, unknown>;
}

function fakeHelper(answers: Record<string, (parameters: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  useHostdTransport(async (method, parameters) => {
    calls.push({ method, parameters });
    const answer = answers[method];
    if (!answer) throw new HostdError('NotFound', `no fake for ${method}`);
    return answer(parameters);
  });
  return calls;
}

const capabilities = () => ({
  version: '1.0.0',
  system: true,
  storage: { raid: true, smart: true, efi: true },
  backup: { installed: true, initialized: true },
  power: { ec: true, os: true, ryzenadj: true },
});

const system = () => ({
  hostname: 'kingston-server',
  kernel: '6.12.107+deb13-amd64',
  boardVendor: 'Bosgame',
  boardName: 'AXB35-02',
  productName: 'BeyondMax Series',
  cpuModel: 'AMD RYZEN AI MAX+ 395 w/ Radeon 8060S',
  cpuCount: 32,
  uptimeSeconds: 3600,
  load: [1, 1, 1],
  memory: {
    totalBytes: 33_277_624_320,
    availableBytes: 22_139_301_888,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    pressure: null,
    underPressure: false,
  },
  gpuMemory: {
    vramTotalBytes: 103_079_215_104,
    vramUsedBytes: 1,
    gttTotalBytes: 1,
    gttUsedBytes: 1,
  },
  efi: true,
});

const healthy = {
  Capabilities: capabilities,
  SystemStatus: system,
  StorageStatus: () => storage(),
  PowerStatus: () => power(),
  BackupStatus: () => backup(),
  Events: () => ({ events: [], seenUpTo: 0, unseen: 0, unseenCritical: 0 }),
};

describe('Administrator → Server', () => {
  beforeEach(async () => {
    await resetDb();
    invalidate();
  });
  afterEach(() => {
    useHostdTransport(null);
    invalidate();
  });

  it('shows the owner every area with its health lines', async () => {
    fakeHelper(healthy);
    const { god } = await setup();
    const { data, status } = await god.api.god.server.get();
    expect(status).toBe(200);
    expect(data!.helper).toEqual({ available: true, version: '1.0.0', reason: null });
    expect(data!.areas.map((area) => area.area)).toEqual(['overview', 'disks', 'backup', 'power']);
    expect(data!.state).toBe('attention');
    const disks = data!.capabilities.find((capability) => capability.area === 'disks')!;
    expect(disks.health.find((item) => item.id === 'raid:helena-root')).toMatchObject({
      state: 'attention',
      code: 'raidRebuilding',
    });
  });

  it('hides nothing but reports every area unavailable without the helper', async () => {
    useHostdTransport(async () => {
      throw new HostdError('Unavailable', 'The host helper is not installed or not running');
    });
    const { god } = await setup();
    const { data } = await god.api.god.server.get();
    expect(data!.helper.available).toBe(false);
    expect(data!.areas.every((area) => !area.available)).toBe(true);
    const reading = await god.api.god.server.disks.get({ query: {} });
    expect(reading.status).toBe(503);
  });

  it('is the owner’s alone', async () => {
    fakeHelper(healthy);
    await setup();
    const other = authedApi((await signUpTestUser({ email: 'someone@example.com' })).cookie);
    expect((await other.god.server.get()).status).toBe(403);
    expect((await other.god.server.power.get({ query: {} })).status).toBe(403);
  });

  it('changes need the owner’s session in the app, never an API key', async () => {
    const calls = fakeHelper({
      ...healthy,
      SetFans: (parameters) => ({ ...parameters, applied: true }),
    });
    const { god } = await setup();
    const withoutOrigin = await god.api.god.server.power.fans.put({ mode: 'fixed', level: 5 });
    expect(withoutOrigin.status).toBe(403);
    const byKey = await apiKeyApi(await apiKeyOf(god.cookie)).god.server.power.fans.put({
      mode: 'auto',
    });
    expect(byKey.status).toBe(403);
    expect(calls.filter((call) => call.method === 'SetFans')).toHaveLength(0);
  });

  it('sets the fans, the profile and the guard through the helper, with the actor', async () => {
    const calls = fakeHelper({
      ...healthy,
      SetFans: (parameters) => ({ mode: parameters.mode, level: parameters.level, applied: true }),
      SetPowerProfile: (parameters) => ({ profile: parameters.profile, layers: {} }),
      SetGuard: (parameters) => ({ limit: parameters.limit }),
    });
    const { god } = await setup();
    const api = god.interactive;
    expect((await api.god.server.power.fans.put({ mode: 'fixed', level: 3 })).status).toBe(200);
    expect((await api.god.server.power.profile.put({ profile: 'saver' })).status).toBe(200);
    expect((await api.god.server.power.guard.put({ limit: 85 })).status).toBe(200);
    expect(calls.find((call) => call.method === 'SetFans')!.parameters).toEqual({
      mode: 'fixed',
      level: 3,
      actor: 'root@example.com',
    });
    // A level outside 1–5 never reaches the helper.
    expect((await api.god.server.power.fans.put({ mode: 'fixed', level: 7 } as never)).status).toBe(
      400,
    );
    expect(calls.filter((call) => call.method === 'SetFans')).toHaveLength(1);
  });

  it('restoring in place needs the path typed again', async () => {
    const calls = fakeHelper({
      ...healthy,
      StartRestore: (parameters) => ({ id: 'x', ...parameters }),
    });
    const { god } = await setup();
    const api = god.interactive;
    const refused = await api.god.server.backup.restores.post({
      snapshot: 'abcdef12',
      path: '/home/owner/notes.md',
      mode: 'original',
    });
    expect(refused.status).toBe(400);
    const done = await api.god.server.backup.restores.post({
      snapshot: 'abcdef12',
      path: '/home/owner/notes.md',
      mode: 'original',
      confirm: '/home/owner/notes.md',
    });
    expect(done.status).toBe(200);
    expect(calls.filter((call) => call.method === 'StartRestore')).toHaveLength(1);
  });

  it('shows the backup password without caching, and maps the helper’s refusals', async () => {
    let acknowledged = false;
    fakeHelper({
      ...healthy,
      RevealBackupPassword: () => {
        if (acknowledged)
          throw new HostdError('NotAllowed', 'the password was already written down');
        return { password: 'correct-horse-battery' };
      },
      AcknowledgeBackupPassword: () => {
        acknowledged = true;
        return { passwordState: 'acknowledged' };
      },
    });
    const { god } = await setup();
    const response = await app.handle(
      new Request('http://localhost/god/server/backup/password/reveal', {
        method: 'POST',
        headers: { cookie: god.cookie, ...ORIGIN },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ password: 'correct-horse-battery' });
    const api = god.interactive;
    expect((await api.god.server.backup.password.acknowledge.post()).status).toBe(200);
    const again = await api.god.server.backup.password.reveal.post();
    expect(again.status).toBe(409);
  });

  it('offsite targets stay off without the flag', async () => {
    fakeHelper(healthy);
    const { god } = await setup();
    const api = god.interactive;
    const response = await api.god.server.backup.targets({ id: 'offsite' }).put({
      repository: 's3:https://s3.example.com/bucket',
      credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secretsecret' },
    });
    expect(response.status).toBe(404);
  });
});
