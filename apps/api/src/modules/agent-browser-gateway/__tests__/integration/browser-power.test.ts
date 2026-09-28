import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { alwaysOnSlugs, sanitizeBrowserPower } from '../../power';

// Project browsers on demand (power.ts): the instance owner sets the idle time and the
// browsers kept running in Helena; the browser router reads them by slug with its token.

const GATEWAY_TOKEN = 'test-browser-gateway-token-0123456789abcdef0123';

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-power-'));
  const file = join(directory, 'token');
  writeFileSync(file, GATEWAY_TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
});

function routerRead(token: string | undefined = GATEWAY_TOKEN) {
  return app.handle(
    new Request('http://localhost/internal/browser-gateway/power', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

describe('browser power settings', () => {
  beforeEach(resetDb);

  it('start at 15 minutes, nothing kept running, and read back what the owner saves', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;

    const initial = await asOwner.god['browser-power'].get();
    expect(initial.status).toBe(200);
    expect(initial.data).toEqual({ idleMinutes: 15, alwaysOnProjectIds: [], homeAlwaysOn: false });

    const saved = await asOwner.god['browser-power'].put({
      idleMinutes: 30,
      alwaysOnProjectIds: [mkt.id],
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ idleMinutes: 30, alwaysOnProjectIds: [mkt.id], homeAlwaysOn: false });

    // A partial update keeps the rest.
    const home = await asOwner.god['browser-power'].put({ homeAlwaysOn: true });
    expect(home.data).toEqual({ idleMinutes: 30, alwaysOnProjectIds: [mkt.id], homeAlwaysOn: true });
    expect((await asOwner.god['browser-power'].get()).data).toEqual(home.data!);
  });

  it('refuses an idle time out of range and projects that do not exist', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    expect((await asOwner.god['browser-power'].put({ idleMinutes: -1 })).status).toBe(400);
    expect((await asOwner.god['browser-power'].put({ idleMinutes: 2000 })).status).toBe(400);
    expect((await asOwner.god['browser-power'].put({ alwaysOnProjectIds: [999999] })).status).toBe(
      400,
    );
    expect((await asOwner.god['browser-power'].put({ idleMinutes: 0 })).data?.idleMinutes).toBe(0);
  });

  it('is the instance owner’s alone', async () => {
    await signUpTestUser({ name: 'Owner' });
    const other = await signUpTestUser({ name: 'Other' });
    const asOther = authedApi(other.cookie);
    expect((await asOther.god['browser-power'].get()).status).toBe(403);
    expect((await asOther.god['browser-power'].put({ idleMinutes: 5 })).status).toBe(403);
  });

  it('reaches the browser router by slug, with its token only', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
    await asOwner.god['browser-power'].put({
      idleMinutes: 5,
      alwaysOnProjectIds: [mkt.id],
      homeAlwaysOn: true,
    });

    expect((await routerRead(undefined)).status).toBe(401);
    expect((await routerRead('x'.repeat(48))).status).toBe(401);
    const res = await routerRead();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, idleMinutes: 5, alwaysOn: ['home', 'mkt'] });
  });

  it('keeps a stored value it cannot use from reaching the router', () => {
    expect(sanitizeBrowserPower({ idleMinutes: 'x', alwaysOnProjectIds: [3, 3, -1, 'a'] })).toEqual({
      idleMinutes: 15,
      alwaysOnProjectIds: [3],
      homeAlwaysOn: false,
    });
    expect(
      alwaysOnSlugs({ idleMinutes: 15, alwaysOnProjectIds: [1, 2, 7], homeAlwaysOn: false }, [
        { id: 1, key: 'VOL' },
        { id: 2, key: 'VERV' },
      ]),
    ).toEqual(['verve', 'vol']);
  });
});
