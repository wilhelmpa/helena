import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpstream } from './routing.mjs';

const route = {
  target: 'http://127.0.0.1:18789',
  paths: [
    { prefix: '/backend', target: 'http://127.0.0.1:3000' },
    { prefix: '/workspace/code', target: 'http://127.0.0.1:8091' },
    { prefix: '/browser', target: 'http://127.0.0.1:6082' },
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
test('code-server stays behind the authenticated Plan origin and strips only its route prefix', () => {
  assert.deepEqual(resolveUpstream(route, '/workspace/code/?folder=%2Fprojects%2Fdemo'), {
    target: 'http://127.0.0.1:8091',
    url: '/?folder=%2Fprojects%2Fdemo',
  });
  assert.deepEqual(resolveUpstream(route, '/workspace/code/stable/out/vs/workbench.js'), {
    target: 'http://127.0.0.1:8091',
    url: '/stable/out/vs/workbench.js',
  });
});
test('project browser stays behind the Plan origin and strips only the router prefix', () => {
  assert.deepEqual(resolveUpstream(route, '/browser/projects/demo/vnc.html?autoconnect=1'), {
    target: 'http://127.0.0.1:6082',
    url: '/projects/demo/vnc.html?autoconnect=1',
  });
});
test('prefix lookalikes cannot select a privileged path route', () => {
  for (const url of ['/backend-evil', '/focus/terminal-project/verve2/ws', '/focus/terminal-project/verve%2fws']) {
    assert.deepEqual(resolveUpstream(route, url), { target: route.target, url });
  }
});
