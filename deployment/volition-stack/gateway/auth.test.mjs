import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { makeAuthenticator, trustedHeaders } from './auth.mjs';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const config = {
  issuer: 'https://access.example.test', ownerEmail: 'owner@example.test',
  routes: { 'app.example.test': { audience: 'test-audience', origins: ['https://app.example.test'], remoteUser: 'owner' } },
};
const authenticate = makeAuthenticator(config, publicKey);
async function token(overrides = {}) {
  return new SignJWT({ email: config.ownerEmail, type: 'app', ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(config.issuer).setAudience('test-audience')
    .setSubject('owner-id').setIssuedAt().setExpirationTime('1h').sign(privateKey);
}
function req(jwt, headers = {}, method = 'GET') {
  return { method, headers: { host: 'app.example.test', 'cf-access-jwt-assertion': jwt, 'cf-connecting-ip': '203.0.113.4', ...headers } };
}
test('accepts a signed exact owner assertion', async () => {
  assert.equal((await authenticate(req(await token()))).payload.email, config.ownerEmail);
});
test('rejects missing assertion, wrong owner, unknown host and wrong origin', async () => {
  for (const request of [req(undefined), req(await token({ email: 'other@example.test' })), req(await token(), { host: 'evil.test' }), req(await token(), { origin: 'https://evil.test' })]) await assert.rejects(authenticate(request));
});
test('rejects tampering, wrong audience, expired assertions and untrusted signing keys', async () => {
  const make = (key, audience, expiry) => new SignJWT({ email: config.ownerEmail, type: 'app' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(config.issuer).setAudience(audience).setSubject('x').setIssuedAt().setExpirationTime(expiry).sign(key);
  const other = await generateKeyPair('RS256');
  for (const jwt of [(await token())+'x', await make(privateKey, 'wrong', '1h'), await make(privateKey, 'test-audience', Math.floor(Date.now()/1000)-60), await make(other.privateKey, 'test-audience', '1h')]) await assert.rejects(authenticate(req(jwt)));
});
test('requires allowed Origin on writes and WebSocket upgrades', async () => {
  const jwt = await token();
  await assert.rejects(authenticate(req(jwt, {}, 'POST')));
  await assert.rejects(authenticate(req(jwt, { upgrade: 'websocket' })));
  await authenticate(req(jwt, { origin: 'https://app.example.test' }, 'POST'));
});
test('replaces spoofed proxy identity and removes the access assertion', async () => {
  const request = req(await token(), { 'x-forwarded-user': 'root', 'remote-user': 'root', 'x-volition-auth': 'fake', forwarded: 'for=attacker' });
  const identity = await authenticate(request);
  trustedHeaders(request, identity);
  assert.equal(request.headers['x-forwarded-user'], config.ownerEmail);
  assert.equal(request.headers['remote-user'], 'owner');
  assert.equal(request.headers['x-volition-auth'], 'verified');
  assert.equal(request.headers['x-forwarded-for'], '203.0.113.4');
  assert.equal(request.headers.forwarded, undefined);
  assert.equal(request.headers['cf-access-jwt-assertion'], undefined);
});
test('does not leak Cloudflare or planner cookies to embedded services', async () => {
  const request = req(await token(), { cookie: 'CF_Authorization=secret; CF_BindingCookie=secret; __Secure-better-auth.session_token=secret; paperless_sessionid=allowed' });
  trustedHeaders(request, await authenticate(request));
  assert.equal(request.headers.cookie, 'paperless_sessionid=allowed');
});
