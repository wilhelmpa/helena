import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncthingUnavailable, syncthingJson } from '../../syncthing';

// Which key files the API accepts for Syncthing: owner-only anywhere, group-readable only
// inside the unit's own systemd credential directory (how a native boot presents
// LoadCredential files). Against a local stand-in for Syncthing's REST API.

const KEY = 'syncthing-test-key-0123456789abcdef0123456789';
const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'syncthing-key-'));
const credentials = join(work, 'credentials');
const saved = {
  url: process.env.SYNCTHING_URL,
  file: process.env.SYNCTHING_API_KEY_FILE,
  dir: process.env.CREDENTIALS_DIRECTORY,
};
let server: ReturnType<typeof Bun.serve>;

function keyFile(dir: string, mode: number): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'syncthing_api_key');
  writeFileSync(file, `${KEY}\n`);
  chmodSync(file, mode);
  return file;
}

async function status(file: string): Promise<string> {
  process.env.SYNCTHING_API_KEY_FILE = file;
  try {
    return (await syncthingJson<{ myID: string }>('/rest/system/status')).myID;
  } catch (error) {
    if (error instanceof SyncthingUnavailable) return error.reason;
    throw error;
  }
}

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      request.headers.get('x-api-key') === KEY
        ? Response.json({ myID: 'DEVICE-ID' })
        : new Response('forbidden', { status: 403 }),
  });
  process.env.SYNCTHING_URL = `http://127.0.0.1:${server.port}`;
  process.env.CREDENTIALS_DIRECTORY = credentials;
});

afterEach(() => {
  rmSync(credentials, { recursive: true, force: true });
});

afterAll(() => {
  server.stop(true);
  rmSync(work, { recursive: true, force: true });
  for (const [name, value] of [
    ['SYNCTHING_URL', saved.url],
    ['SYNCTHING_API_KEY_FILE', saved.file],
    ['CREDENTIALS_DIRECTORY', saved.dir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the Syncthing API key file', () => {
  it('accepts a systemd credential presented as 0440', async () => {
    expect(await status(keyFile(credentials, 0o440))).toBe('DEVICE-ID');
  });

  it('accepts an owner-only key anywhere', async () => {
    expect(await status(keyFile(join(work, 'elsewhere'), 0o600))).toBe('DEVICE-ID');
  });

  it('refuses a group-readable key outside the credential directory', async () => {
    expect(await status(keyFile(join(work, 'group'), 0o640))).toBe('unconfigured');
  });

  it('refuses a key others can read, even in the credential directory', async () => {
    expect(await status(keyFile(credentials, 0o444))).toBe('unconfigured');
  });
});
