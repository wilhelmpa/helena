import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const KEY = 'test-syncthing-key-0123456789abcdef0123456789';

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'volition-syncthing-'));
  const vault = join(root, 'vault');
  await mkdir(vault);
  return { root, vault };
}

// A stand-in for the Syncthing REST API that records each request.
async function fakeSyncthing({ folderExists }) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        path: request.url,
        key: request.headers['x-api-key'],
        body: body ? JSON.parse(body) : null,
      });
      const missing = request.method === 'GET' && request.url === '/rest/config/folders/volition';
      response.writeHead(missing && !folderExists ? 404 : 200);
      response.end(request.url === '/rest/noauth/health' ? '{"status":"OK"}' : '');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { requests, server, url: `http://127.0.0.1:${server.address().port}` };
}

test('a dry run lists every change and makes none', async () => {
  const { root, vault } = await scratch();
  const keyFile = join(root, 'syncthing-api.key');
  const { stdout } = await run(join(directory, 'setup.sh'), ['--dry-run'], {
    env: {
      ...process.env,
      VAULT: vault,
      SYNCTHING_HOME: join(root, 'home'),
      SYNCTHING_KEY_FILE: keyFile,
      UNIT_DIR: join(root, 'units'),
    },
  });
  for (const step of [
    '+ groupadd -f volition\n',
    '+ groupadd -f volition-private\n',
    '+ usermod -a -G volition,volition-private volition-sync\n',
    `+ write a new API key to ${keyFile}\n`,
    `vault-defaults.sh ${vault} (as volition-sync)\n`,
    `volition-syncthing.service ${join(root, 'units')}/volition-syncthing.service\n`,
    '+ systemctl restart volition-syncthing.service\n',
    `configure.sh http://127.0.0.1:8384 ${keyFile} ${vault}\n`,
  ]) {
    assert.ok(stdout.includes(step), `missing step: ${step}`);
  }
  assert.equal(existsSync(keyFile), false);
  assert.deepEqual(await readdir(vault), []);
});

test('writes the ignore patterns once and no editor settings', async () => {
  const { vault } = await scratch();
  const script = join(directory, 'vault-defaults.sh');
  await run(script, [vault]);
  const ignore = await readFile(join(vault, '.stignore'), 'utf8');
  for (const pattern of [
    '.git',
    '/.trash',
    '/.obsidian',
    '(?d).DS_Store',
  ]) {
    assert.ok(ignore.split('\n').includes(pattern), `missing pattern: ${pattern}`);
  }
  assert.equal(existsSync(join(vault, '.obsidian')), false);
  assert.ok(existsSync(join(vault, 'Home/Docs/Journal')));
  assert.ok(existsSync(join(vault, 'Templates')));

  await run(script, [vault]);
  assert.equal(await readFile(join(vault, '.stignore'), 'utf8'), ignore);
});

test('keeps the owner’s ignore patterns', async () => {
  const { vault } = await scratch();
  await writeFile(join(vault, '.stignore'), 'Files/Mail\n.git\n');
  await run(join(directory, 'vault-defaults.sh'), [vault]);
  const lines = (await readFile(join(vault, '.stignore'), 'utf8')).split('\n');
  assert.equal(lines[0], 'Files/Mail');
  assert.equal(lines.filter((line) => line === '.git').length, 1);
  assert.ok(lines.includes('/.trash'));
});

test('adds the folder Helena with the API key and turns reports off', async () => {
  const { root, vault } = await scratch();
  const keyFile = join(root, 'key');
  await writeFile(keyFile, `${KEY}\n`, { mode: 0o600 });
  const syncthing = await fakeSyncthing({ folderExists: false });
  try {
    await run(join(directory, 'configure.sh'), [syncthing.url, keyFile, vault]);
  } finally {
    syncthing.server.close();
  }
  const writes = syncthing.requests.filter((request) => request.method !== 'GET');
  assert.deepEqual(writes, [
    {
      method: 'POST',
      path: '/rest/config/folders',
      key: KEY,
      body: {
        id: 'volition',
        label: 'Helena',
        path: vault,
        type: 'sendreceive',
        ignorePerms: true,
      },
    },
    {
      method: 'PATCH',
      path: '/rest/config/options',
      key: KEY,
      body: { crashReportingEnabled: false, urAccepted: -1 },
    },
  ]);
});

test('updates an existing folder and leaves its devices alone', async () => {
  const { root, vault } = await scratch();
  const keyFile = join(root, 'key');
  await writeFile(keyFile, KEY, { mode: 0o600 });
  const syncthing = await fakeSyncthing({ folderExists: true });
  try {
    await run(join(directory, 'configure.sh'), [syncthing.url, keyFile, vault]);
  } finally {
    syncthing.server.close();
  }
  const folderWrite = syncthing.requests.find((request) => request.path.startsWith('/rest/config/folders') && request.method !== 'GET');
  assert.deepEqual(folderWrite, {
    method: 'PATCH',
    path: '/rest/config/folders/volition',
    key: KEY,
    body: { label: 'Helena', path: vault, type: 'sendreceive', ignorePerms: true },
  });
});
