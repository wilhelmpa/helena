import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createStudioProxy } from '../readonly-proxy.mjs';

const UPSTREAM = 'u'.repeat(64);
const CONTROL = 'c'.repeat(64);
const INGRESS = 'i'.repeat(64);
const GATEWAY = 'g'.repeat(64);

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// A stand-in for Mastra that records what reaches it.
async function withProxy(tokens, check) {
  const seen = [];
  const mastra = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ runs: [] }));
  });
  const upstreamPort = await listen(mastra);
  const proxy = createStudioProxy({ upstreamPort, upstreamToken: UPSTREAM, controlToken: CONTROL, ...tokens });
  const port = await listen(proxy);
  try {
    await check(`http://127.0.0.1:${port}`, seen);
  } finally {
    proxy.close();
    mastra.close();
  }
}

const control = (origin, authorization) =>
  fetch(`${origin}/internal/mastra/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({ schemaVersion: 1, operation: 'runs', workflowId: 'agent-team', projectRef: 'project:PRIV' }),
  });

test('Studio needs the gateway token that Nginx adds and trusts no identity header', async () => {
  await withProxy({ gatewayToken: GATEWAY }, async (origin, seen) => {
    for (const headers of [
      {},
      { 'x-volition-auth': 'verified', 'x-auth-request-email': 'owner@example.com' },
      { 'x-volition-gateway-token': 'g'.repeat(63) },
      { authorization: `Bearer ${UPSTREAM}` },
    ]) {
      assert.equal((await fetch(`${origin}/mastra/api/workflows`, { headers })).status, 403);
    }
    assert.equal(seen.length, 0);

    const response = await fetch(`${origin}/mastra/api/workflows`, {
      headers: { 'x-volition-gateway-token': GATEWAY, cookie: 'session=plan' },
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers.authorization, `Bearer ${UPSTREAM}`);
    assert.equal(seen[0].headers['x-volition-gateway-token'], undefined);
    assert.equal(seen[0].headers.cookie, undefined);
  });
});

test('Studio is closed without a gateway token', async () => {
  await withProxy({}, async (origin, seen) => {
    const response = await fetch(`${origin}/mastra/workflows`, {
      headers: { 'x-volition-gateway-token': '' },
    });
    assert.equal(response.status, 403);
    assert.equal(seen.length, 0);
  });
});

test('control requests need the control token and reach Mastra with the upstream token', async () => {
  await withProxy({ ingressToken: INGRESS, gatewayToken: GATEWAY }, async (origin, seen) => {
    for (const authorization of [undefined, `Bearer ${INGRESS}`, `Bearer ${GATEWAY}`, `Bearer ${UPSTREAM}`]) {
      assert.equal((await control(origin, authorization)).status, 401);
    }
    assert.equal(seen.length, 0);

    const response = await control(origin, `Bearer ${CONTROL}`);
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /^\/mastra\/api\/workflows\/agent-team\/runs\?resourceId=project:PRIV/);
    assert.equal(seen[0].headers.authorization, `Bearer ${UPSTREAM}`);
  });
});

test('the event and inbox ingress need the ingress token and are closed without one', async () => {
  const post = (origin, path, authorization) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: '{}',
    });
  await withProxy({ ingressToken: INGRESS }, async (origin, seen) => {
    for (const path of ['/internal/events', '/internal/inbox/triage']) {
      assert.equal((await post(origin, path, `Bearer ${CONTROL}`)).status, 401);
      assert.equal((await post(origin, path, `Bearer ${INGRESS}`)).status, 400);
    }
    assert.equal(seen.length, 0);
  });
  await withProxy({}, async (origin, seen) => {
    for (const path of ['/internal/events', '/internal/inbox/triage']) {
      assert.notEqual((await post(origin, path, `Bearer ${INGRESS}`)).status, 200);
    }
    assert.equal(seen.length, 0);
  });
});
