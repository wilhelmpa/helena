import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The env var the router's module-level `keyPath` reads has to be set before the
// module is evaluated, so the key file is written and the env var set first, and
// the module imported with a dynamic import afterward (a static import is
// hoisted ahead of any code in this file).
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'owner-terminal-key-'));
const keyPath = path.join(tmpDir, 'owner-terminal.key');
const key = 'test-key-material-not-a-real-secret';
await writeFile(keyPath, key, 'utf8');
process.env.OWNER_TERMINAL_KEY_PATH = keyPath;

const {
  requestTarget,
  verifyToken,
  slugFrom,
  upstreamHeaders,
  downstreamHeaders,
  KINDS,
} = await import('./owner-terminal-router.mjs');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Mints a token the same way apps/api/src/modules/owner-terminal/token.ts does,
// so this test exercises the router's *own* verification against the real wire
// format rather than a mock of it.
function mintToken(payload, signingKey = key) {
  const body = base64url(JSON.stringify(payload));
  const mac = base64url(createHmac('sha256', signingKey).update(body).digest());
  return `${body}.${mac}`;
}

function validPayload(overrides = {}) {
  return {
    sessionId: 'sess-1',
    kind: 'shell',
    purpose: 'owner-terminal',
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
}

test('every fixed kind is in the router allowlist and nothing else is', () => {
  assert.deepEqual(
    [...KINDS].sort(),
    ['claude', 'codex', 'helena-dev-claude', 'helena-dev-codex', 'shell'].sort(),
  );
});

test('accepts bounded session names', () => {
  assert.equal(slugFrom('main'), 'main');
  assert.equal(slugFrom('scratch-2'), 'scratch-2');
  for (const value of ['', '../x', 'MAIN', 'a/b', 'a'.repeat(33)]) assert.equal(slugFrom(value), null);
});

test('a correctly signed, current token for the right kind verifies', async () => {
  const token = mintToken(validPayload());
  const payload = await verifyToken(token, 'shell');
  assert.ok(payload);
  assert.equal(payload.sessionId, 'sess-1');
});

test('rejects a forged token', async () => {
  const token = mintToken(validPayload(), 'a-completely-different-key');
  assert.equal(await verifyToken(token, 'shell'), null);
});

test('rejects a tampered payload even when the signature was valid for something else', async () => {
  const token = mintToken(validPayload());
  const [body, mac] = token.split('.');
  const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  tampered.kind = 'claude';
  const forgedBody = base64url(JSON.stringify(tampered));
  assert.equal(await verifyToken(`${forgedBody}.${mac}`, 'claude'), null);
});

test('rejects an expired token', async () => {
  const token = mintToken(validPayload({ exp: Math.floor(Date.now() / 1000) - 5 }));
  assert.equal(await verifyToken(token, 'shell'), null);
});

test('rejects a token minted for a different kind (no replay across sessions)', async () => {
  const token = mintToken(validPayload({ kind: 'shell' }));
  assert.equal(await verifyToken(token, 'claude'), null);
});

test('rejects a token with the wrong purpose', async () => {
  const token = mintToken(validPayload({ purpose: 'something-else' }));
  assert.equal(await verifyToken(token, 'shell'), null);
});

test('rejects malformed and empty tokens without throwing', async () => {
  for (const bad of [undefined, '', 'not-a-token', 'only-one-part', '..']) {
    assert.equal(await verifyToken(bad, 'shell'), null);
  }
});

test('rejects untrusted hosts, origins and ambiguous or unknown-kind paths', () => {
  assert.equal(
    requestTarget({ url: '/focus/owner-terminal/shell/main/', headers: { host: 'evil.example' } })
      .status,
    403,
  );
  assert.equal(
    requestTarget({
      url: '/focus/owner-terminal/shell/main/',
      headers: { host: 'kingston-server.local', origin: 'http://evil.example' },
    }).status,
    403,
  );
  for (const url of [
    '/focus/owner-terminal/shell/../etc/',
    '/focus/owner-terminal/sudo-as-root/main/',
    '/focus/owner-terminal/shell/UPPER/',
    '/focus/owner-terminal/shell/main%2f/',
  ]) {
    assert.ok(
      requestTarget({ url, headers: { host: 'kingston-server.local' } }).status >= 400,
      url,
    );
  }
});

test('a valid path carries the kind, name and full upstream path through', () => {
  // wetty is started with --base /focus/owner-terminal/<kind>/<name> and routes
  // against that itself, so the full path (unstripped) is what has to reach it.
  const url = '/focus/owner-terminal/helena-dev-claude/main/socket.io/';
  const target = requestTarget({
    url,
    headers: { host: 'kingston-server.local', 'x-owner-terminal-token': 'abc.def' },
  });
  assert.deepEqual(
    { kind: target.kind, name: target.name, upstreamPath: target.upstreamPath, token: target.token },
    { kind: 'helena-dev-claude', name: 'main', upstreamPath: url, token: 'abc.def' },
  );
});

test('never forwards the browser session cookie, auth header or the owner-terminal token upstream', () => {
  assert.deepEqual(
    upstreamHeaders({
      host: 'kingston-server.local',
      cookie: 'better-auth.session=secret',
      authorization: 'Bearer secret',
      'x-owner-terminal-token': 'abc.def',
      upgrade: 'websocket',
    }),
    { host: 'kingston-server.local', upgrade: 'websocket' },
  );
});

test('local HTTP terminal does not upgrade its own assets to unavailable HTTPS', () => {
  assert.deepEqual(
    downstreamHeaders({
      'content-security-policy':
        "default-src 'self'; upgrade-insecure-requests; connect-src 'self' ws://kingston-server.local",
      'content-type': 'text/html; charset=utf-8',
      etag: 'old-page',
    }),
    {
      'content-security-policy': "default-src 'self'; connect-src 'self' ws://kingston-server.local",
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  );
});

test('the close path is recognised for POST only and never forwarded to wetty', () => {
  const host = { host: 'kingston-server.local' };
  const closing = requestTarget({
    url: '/focus/owner-terminal/claude/main-2/__helena/close',
    method: 'POST',
    headers: host,
  });
  assert.equal(closing.close, true);
  assert.equal(closing.kind, 'claude');
  assert.equal(closing.name, 'main-2');
  assert.equal(closing.upstreamPath, undefined);
  assert.equal(
    requestTarget({ url: '/focus/owner-terminal/claude/main-2/__helena/close', method: 'GET', headers: host })
      .status,
    405,
  );
  assert.equal(
    requestTarget({ url: '/focus/owner-terminal/shell/main/', method: 'POST', headers: host }).close,
    undefined,
  );
});
