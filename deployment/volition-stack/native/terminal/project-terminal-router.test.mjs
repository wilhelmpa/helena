import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requestTarget,
  slugFrom,
  upstreamHeaders,
  downstreamHeaders,
  tmuxSessionSlugs,
  removedProjects,
} from './project-terminal-router.mjs';

test('accepts bounded project slugs', () => {
  assert.equal(slugFrom('vol'), 'vol');
  assert.equal(slugFrom('project-123'), 'project-123');
  for (const value of ['', '../vol', 'VOL', 'vol/x', 'a'.repeat(33)]) assert.equal(slugFrom(value), null);
});

test('legacy links redirect to the canonical project path', () => {
  assert.deepEqual(requestTarget({
    url: '/focus/terminal-project/?arg=vol',
    headers: { host: 'kingston-server.local' },
  }), { redirect: '/focus/terminal-project/vol/' });
  assert.deepEqual(requestTarget({
    url: '/focus/terminal-project?arg=vol',
    headers: { host: 'kingston-server.local' },
  }), { slug: 'vol', upstreamPath: '/focus/terminal-project/vol' });
});

test('rejects untrusted hosts, origins and ambiguous paths', () => {
  assert.equal(requestTarget({ url: '/focus/terminal-project/vol/', headers: { host: 'evil.example' } }).status, 403);
  assert.equal(requestTarget({
    url: '/focus/terminal-project/vol/',
    headers: { host: 'kingston-server.local', origin: 'http://evil.example' },
  }).status, 403);
  for (const url of [
    '/focus/terminal-project/?arg=../vol',
    '/focus/terminal-project/?arg=vol&command=id',
    '/focus/terminal-project/vol%2fetc/',
  ]) assert.ok(requestTarget({ url, headers: { host: 'kingston-server.local' } }).status >= 400);
});

test('never forwards browser credentials to Wetty', () => {
  assert.deepEqual(upstreamHeaders({
    host: 'kingston-server.local',
    cookie: 'session=secret',
    authorization: 'Bearer secret',
    'proxy-authorization': 'Basic secret',
    upgrade: 'websocket',
  }), {
    host: 'kingston-server.local',
    upgrade: 'websocket',
  });
});

test('local HTTP terminal does not upgrade its own assets to unavailable HTTPS', () => {
  assert.deepEqual(downstreamHeaders({
    'content-security-policy': "default-src 'self'; upgrade-insecure-requests; connect-src 'self' ws://kingston-server.local",
    'content-type': 'text/html; charset=utf-8',
    etag: 'old-page',
  }), {
    'content-security-policy': "default-src 'self'; connect-src 'self' ws://kingston-server.local",
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
});

test('finds the project tmux sessions and ignores every other session', () => {
  assert.deepEqual(tmuxSessionSlugs('volition-vol\nvolition-fam\nscratch\nvolition-../x\n'), ['vol', 'fam']);
});

test('selects the projects whose workspace no longer exists', async () => {
  const workspaces = new Set(['vol']);
  assert.deepEqual(
    await removedProjects(['vol', 'gone', 'gone'], async slug => workspaces.has(slug)),
    ['gone'],
  );
});
