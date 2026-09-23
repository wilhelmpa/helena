import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile, unlink } from 'node:fs/promises';
import http from 'node:http';
import { createHermesTeamService, HermesTeamError } from './hermes-team-bridge-core.mjs';

const MAX_BODY = 512 * 1024;

async function secret(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('invalid secret file');
  const value = (await readFile(path, 'utf8')).trim();
  if (Buffer.byteLength(value) < 32 || value.length > 2_048) throw new Error('invalid secret');
  return value;
}

function equalSecret(given, expected) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function planOrigin() {
  const value = process.env.PLAN_INTERNAL_URL?.trim() || 'http://127.0.0.1:3000';
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password)
    throw new Error('invalid Plan URL');
  return url.origin;
}

// Plan not answering, or failing on its side, is `plan_unavailable`: a request the bridge
// may send again. Any other refusal is Plan's answer.
async function planRequest(path, body, token) {
  const response = await fetch(planOrigin() + path, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { throw new HermesTeamError(502, 'plan_unavailable', 'Plan is unavailable'); });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value.error === 'string' ? value.error : 'Plan rejected the request';
    if (response.status >= 500) throw new HermesTeamError(502, 'plan_unavailable', message);
    throw new HermesTeamError(response.status, 'plan_request_failed', message);
  }
  return value;
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new HermesTeamError(413, 'request_too_large', 'Request is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HermesTeamError(400, 'invalid_json', 'Request body is invalid'); }
}

export function createHermesTeamHandler({ bridgeToken }, service) {
  return async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        response.statusCode = 200;
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      const authorization = request.headers.authorization ?? '';
      const given = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!equalSecret(given, bridgeToken)) throw new HermesTeamError(401, 'unauthorized', 'Unauthorized');
      if (request.method !== 'POST') throw new HermesTeamError(405, 'method_not_allowed', 'Method not allowed');
      if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
        throw new HermesTeamError(415, 'unsupported_media_type', 'JSON is required');
      const body = await readBody(request);
      // Mastra closes the connection when it stops waiting for the stage.
      const abandoned = new AbortController();
      response.once('close', () => {
        if (!response.writableFinished) abandoned.abort();
      });
      const routes = {
        '/internal/hermes/team/stages': () => service.executeStage(body, abandoned.signal),
        '/internal/hermes/team/stages/cancel': () => service.cancelStage(body),
        '/internal/hermes/team/synchronize': () => service.synchronize(body),
        '/internal/hermes/team/routine': () => service.routine(body),
      };
      const result = Object.hasOwn(routes, request.url) ? await routes[request.url]() : null;
      if (!result) throw new HermesTeamError(404, 'not_found', 'Not found');
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      const safe = error instanceof HermesTeamError ? error : new HermesTeamError(500, 'internal_error', 'Hermes team bridge failed');
      response.statusCode = safe.status;
      response.end(JSON.stringify({ error: safe.code, message: safe.message }));
    }
  };
}

export async function startHermesTeamBridge() {
  const bridgeToken = await secret(process.env.HERMES_TEAM_TOKEN_FILE);
  const planToken = await secret(process.env.PLAN_CONTROL_TOKEN_FILE);
  const socketPath = process.env.HERMES_TEAM_SOCKET || '/run/volition-ipc/hermes-team.sock';
  if (!socketPath.startsWith('/run/volition-ipc/') || !socketPath.endsWith('.sock')) throw new Error('invalid socket path');
  const plan = {
    enqueue: body => planRequest('/internal/orchestration/agent-run', body, planToken),
    status: body => planRequest('/internal/orchestration/agent-run/status', body, planToken),
    cancel: body => planRequest('/internal/orchestration/agent-run/cancel', body, planToken),
    synchronize: body => planRequest('/internal/orchestration/task-sync', body, planToken),
    routine: body => planRequest('/internal/orchestration/routine', body, planToken),
  };
  const service = createHermesTeamService(plan);
  const server = http.createServer(createHermesTeamHandler({ bridgeToken, planToken }, service));
  await lstat(socketPath).then(stat => {
    if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error('unsafe socket path');
    return unlink(socketPath);
  }).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  await import('node:fs/promises').then(({ chmod }) => chmod(socketPath, 0o600));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  return server;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  startHermesTeamBridge().catch(() => process.exit(1));
