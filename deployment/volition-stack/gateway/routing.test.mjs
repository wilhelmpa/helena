import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpstream } from './routing.mjs';

const route = {
  target: 'http://127.0.0.1:18789',
  paths: [
    { prefix: '/backend', target: 'http://127.0.0.1:3000' },
    { prefix: '/focus/terminal-project/verve', target: 'http://127.0.0.1:8101', stripPrefix: false },
  ],
};
test('API prefix is stripped including root and query', () => {
  assert.deepEqual(resolveUpstream(route, '/backend'), { target: 'http://127.0.0.1:3000', url: '/' });
  assert.equal(resolveUpstream(route, '/backend/api/auth/session').url, '/api/auth/session');
  assert.equal(resolveUpstream(route, '/backend?x=1').url, '?x=1');
});
test('terminal HTTP and websocket preserve their configured base path', () => {
  for (const suffix of ['', '/', '/ws', '?v=1']) {
    const url = `/focus/terminal-project/verve${suffix}`;
    assert.deepEqual(resolveUpstream(route, url), { target: 'http://127.0.0.1:8101', url });
  }
});
test('prefix lookalikes cannot select a privileged path route', () => {
  for (const url of ['/backend-evil', '/focus/terminal-project/verve2/ws', '/focus/terminal-project/verve%2fws']) {
    assert.deepEqual(resolveUpstream(route, url), { target: route.target, url });
  }
});
