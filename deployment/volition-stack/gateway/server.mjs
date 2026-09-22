import fs from 'node:fs';
import http from 'node:http';
import httpProxy from 'http-proxy';
import { makeAuthenticator, trustedHeaders } from './auth.mjs';
import { makePushAuthenticator, parsePushBody, readPushBody } from './push.mjs';
import { resolveUpstream } from './routing.mjs';

const config = JSON.parse(fs.readFileSync(process.env.GATEWAY_CONFIG ?? '/config/gateway.json', 'utf8'));
const authenticate = makeAuthenticator(config);
const pushRoutes = new Map(Object.entries(config.pushRoutes ?? {}).map(([host, route]) => {
  const token = fs.readFileSync(route.tokenFile, 'utf8').trim();
  if (token.length < 32) throw new Error('Push receiver credential is too short');
  return [host, { route, token, authenticate: makePushAuthenticator(route) }];
}));
const proxy = httpProxy.createProxyServer({ xfwd: false, ws: true, proxyTimeout: 120000, timeout: 120000 });
const identityByRequest = new WeakMap();

proxy.on('error', (_error, _req, res) => {
  if (res.writeHead) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('Service unavailable');
  } else res.destroy();
});
proxy.on('proxyRes', (response, request) => {
  const identity = identityByRequest.get(request);
  response.headers['strict-transport-security'] = 'max-age=31536000';
  response.headers['x-content-type-options'] = 'nosniff';
  response.headers['referrer-policy'] = 'same-origin';
  delete response.headers.server;
  delete response.headers['x-powered-by'];
  if (response.headers['set-cookie']) {
    response.headers['set-cookie'] = response.headers['set-cookie'].map(cookie => /;\s*secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`);
  }
  if (identity?.route.expireLegacyCookieDomain &&
      (request.url.startsWith('/api/auth/') || response.headers['content-type']?.includes('text/html'))) {
    const legacy = ['session_token', 'session_data', 'dont_remember'].flatMap(name =>
      ['', '__Secure-'].map(prefix => `${prefix}better-auth.${name}=; Domain=${identity.route.expireLegacyCookieDomain}; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`));
    response.headers['set-cookie'] = [...(response.headers['set-cookie'] ?? []), ...legacy];
  }
  if (identity?.route.frameAncestors) {
    delete response.headers['x-frame-options'];
    const policy = response.headers['content-security-policy'];
    const policies = Array.isArray(policy) ? policy : policy ? [policy] : [''];
    response.headers['content-security-policy'] = policies.map(value => {
      const directives = value.split(';').map(x => x.trim()).filter(x => x && !/^frame-ancestors\b/i.test(x));
      return [...directives, `frame-ancestors ${identity.route.frameAncestors.join(' ')}`].join('; ');
    });
  }
});

const server = http.createServer(async (request, response) => {
  const push = pushRoutes.get(request.headers.host?.toLowerCase());
  if (push) {
    let pushStage = 'authenticate';
    try {
      await push.authenticate(request);
      pushStage = 'metadata';
      const event = parsePushBody(await readPushBody(request), push.route);
      pushStage = 'receiver';
      const delivered = await fetch(push.route.target, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${push.token}` },
        body: JSON.stringify(event), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!delivered.ok) {
        console.warn(JSON.stringify({event:'gmail_push_rejected',stage:'receiver',status:delivered.status}));
        response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end('Delivery unavailable'); return;
      }
      await delivered.body?.cancel();
      console.log(JSON.stringify({event:'gmail_push_accepted'}));
      response.writeHead(204, { 'Cache-Control': 'no-store' }); response.end();
    } catch (error) {
      console.warn(JSON.stringify({event:'gmail_push_rejected',stage:pushStage,reason:pushStage==='metadata' && ['Unknown subscription','Invalid message id','Invalid data','Mailbox not allowed','Invalid mailbox history','Invalid timestamp','Push too large'].includes(error.message)?error.message:undefined,code:typeof error.code==='string' && /^ERR_[A-Z_]{1,64}$/.test(error.code)?error.code:'INVALID_REQUEST'}));
      response.writeHead(403, { 'Cache-Control': 'no-store' }); response.end('Push denied');
    }
    return;
  }
  const preflightRoute = config.routes[request.headers.host?.toLowerCase()];
  if (request.method === 'OPTIONS' && preflightRoute?.corsOrigin && request.headers.origin === preflightRoute.corsOrigin && request.headers['access-control-request-method']) {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': preflightRoute.corsOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key, x-requested-with, x-csrf-token, better-auth-cookie',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
    response.end();
    return;
  }
  try {
    const identity = await authenticate(request);
    identityByRequest.set(request, identity);
    trustedHeaders(request, identity);
    const upstream = resolveUpstream(identity.route, request.url);
    request.url = upstream.url;
    proxy.web(request, response, { target: upstream.target });
  } catch {
    response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Access denied');
  }
});
server.on('upgrade', async (request, socket, head) => {
  try {
    const identity = await authenticate(request);
    identityByRequest.set(request, identity);
    trustedHeaders(request, identity);
    const lifetime = Math.max(1, Math.min(identity.payload.exp * 1000 - Date.now(), 3600000));
    const expiry = setTimeout(() => socket.destroy(), lifetime);
    expiry.unref();
    socket.once('close', () => clearTimeout(expiry));
    const upstream = resolveUpstream(identity.route, request.url);
    request.url = upstream.url;
    proxy.ws(request, socket, head, { target: upstream.target });
  } catch {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.maxHeadersCount = 100;
server.listen(config.port ?? 8088, '127.0.0.1', () => console.log('Access gateway ready on loopback'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
