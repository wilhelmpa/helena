// The owner terminal: Shell, Claude Code, Codex and "Helena weiterentwickeln"
// (Claude Code / Codex in the dev clone) sessions on this host as `wilhelmpa`,
// persisted in tmux the same way deployment/volition-stack/native/terminal's
// project-terminal-router.mjs persists a project's. Two things set it apart from
// that router, both load-bearing for the security model in
// docs/volition-design-owner-terminals.md:
//
// 1. It listens on a Unix socket, not a loopback TCP port
//    (OWNER_TERMINAL_SOCKET_PATH, default /run/volition-owner-terminal/term.sock),
//    with its group changed to nginx's own (www-data) right after it starts
//    listening -- see fixSocketOwnership() below. A TCP port on 127.0.0.1 is
//    reachable by any local process; a Unix socket's file permissions are not, so
//    this is what actually keeps another user on this host (an isolated
//    per-project Hermes user, once hub/agent-isolation lands; today,
//    volition-hermes) from ever reaching a root-capable shell through it, no
//    matter what nginx does.
// 2. It verifies a signed token on every request and every WebSocket upgrade,
//    independent of the api and of nginx. GET /auth/verify/owner-terminal/:kind
//    in apps/api/src/app.ts checks the session, the owner role and the 12h grant,
//    then mints this token (apps/api/src/modules/owner-terminal/token.ts); nginx's
//    auth_request relays it in X-Owner-Terminal-Token (see
//    nginx-owner-terminal.conf). This file re-implements that same HMAC check
//    from scratch, on purpose: it does not import the api's TypeScript, has no
//    database credentials and calls no other service, so a nginx location pointed
//    at the wrong auth_request target -- or dropped entirely -- opens nothing here.
//    Keep the wire format (payload fields, base64url + '.' + HMAC-SHA256) in sync
//    with that token.ts if either side changes.
import { execFile, spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, chown, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const socketPath = process.env.OWNER_TERMINAL_SOCKET_PATH ?? '/run/volition-owner-terminal/term.sock';
const socketGroup = process.env.OWNER_TERMINAL_SOCKET_GROUP ?? 'www-data';
const runtimeRoot = process.env.OWNER_TERMINAL_RUNTIME_ROOT ?? '/run/volition-owner-terminal/sessions';
const wetty = process.env.WETTY_BIN ?? '/usr/local/bin/wetty';
const shell = process.env.OWNER_TERMINAL_SHELL ?? '/usr/local/libexec/owner-terminal-shell';
const tmux = process.env.TMUX_BIN ?? '/usr/bin/tmux';
const keyPath = process.env.OWNER_TERMINAL_KEY_PATH ?? '/etc/volition/owner-terminal.key';
const recordLogRoot = process.env.OWNER_TERMINAL_RECORD_ROOT ?? '/var/log/volition/owner-terminal';
const publicPrefix = '/focus/owner-terminal';
const allowedHosts = new Set(
  (process.env.OWNER_TERMINAL_ALLOWED_HOSTS ?? 'kingston-server.local,kingston-server')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

// Keep in sync with apps/api/src/modules/owner-terminal/model.ts OWNER_TERMINAL_KINDS.
const KINDS = new Set(['shell', 'claude', 'codex', 'helena-dev-claude', 'helena-dev-codex']);
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const sessions = new Map();
let cachedKey;

async function tokenKey() {
  if (!cachedKey) cachedKey = (await readFile(keyPath, 'utf8')).trim();
  return cachedKey;
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url');
}

// Verifies the token's signature, expiry and purpose, and that it was minted for
// this exact kind -- a token nginx forwarded for /shell/ cannot be replayed
// against /claude/. Returns the parsed payload or null; never throws.
async function verifyToken(token, expectedKind) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  let expectedMac;
  try {
    expectedMac = createHmac('sha256', await tokenKey()).update(body).digest();
  } catch {
    return null; // key file unreadable -- fail closed, not open
  }
  const givenMac = base64urlDecode(mac);
  if (givenMac.length !== expectedMac.length || !timingSafeEqual(givenMac, expectedMac)) return null;
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.purpose !== 'owner-terminal') return null;
  if (payload?.kind !== expectedKind) return null;
  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function resolveGid(groupName) {
  const { stdout } = await run('id', ['-g', groupName]);
  return Number(stdout.trim());
}

// A Unix socket Node creates is owned by this process (wilhelmpa) with a mode
// shaped by the service's UMask=. nginx's worker runs as `socketGroup` (www-data)
// and needs to connect to it, so this widens the socket -- and the directory that
// holds it, which needs +x for the same group to even reach the socket file -- to
// that one group, right after listen() succeeds. The process must already carry
// that group in its credential set (systemd's SupplementaryGroups=, see
// volition-owner-terminal.service) since it is not root and chown(2) only allows
// changing a file's group to one the caller already belongs to.
async function fixSocketOwnership() {
  const gid = await resolveGid(socketGroup);
  await chown(path.dirname(socketPath), process.getuid(), gid);
  await chmod(path.dirname(socketPath), 0o710);
  await chown(socketPath, process.getuid(), gid);
  await chmod(socketPath, 0o660);
}

function slugFrom(value) {
  return typeof value === 'string' && NAME_RE.test(value) ? value : null;
}

async function waitForSocket(path_, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Wetty exited before opening its socket');
    try {
      const stat = await lstat(path_);
      if (stat.isSocket()) return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Wetty did not open its socket');
}

// Opt-in output recording (docs/volition-design-owner-terminals.md §2.4): the
// token carries whether this kind is recorded right now, decided by
// apps/api's owner-terminal settings when it minted the token. Only applied when
// a *new* tmux session is created -- turning recording on does not retroactively
// wrap an already-running session, which is the one a browser reconnect finds.
async function startRecording(kind, name) {
  await mkdir(recordLogRoot, { recursive: true, mode: 0o750 }).catch(() => {});
  const logFile = path.join(recordLogRoot, `${kind}-${name}-${Date.now()}.log`);
  await run(tmux, ['pipe-pane', '-o', '-t', `=owner-${kind}-${name}`, `cat >> '${logFile}'`]).catch(
    () => {},
  );
}

async function session(kind, name, record) {
  const key = `${kind}:${name}`;
  const current = sessions.get(key);
  if (current) return current;
  const pending = (async () => {
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    const wettySocketPath = path.join(runtimeRoot, `${kind}-${name}.sock`);
    await rm(wettySocketPath, { force: true });
    // tmux has-session tells a brand-new session (record should start piping)
    // apart from a reconnect to one that is already running.
    const { code: existed } = await run(tmux, ['has-session', '-t', `=owner-${kind}-${name}`])
      .then(() => ({ code: 0 }))
      .catch(() => ({ code: 1 }));
    const base = `${publicPrefix}/${kind}/${name}`;
    const child = spawn(
      wetty,
      [
        '--socket',
        wettySocketPath,
        '--base',
        base,
        '--command',
        `${shell} ${kind} ${name}`,
        '--allow-iframe',
        '--log-level',
        'warn',
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.once('exit', () => {
      if (sessions.get(key)?.child === child) sessions.delete(key);
      rm(wettySocketPath, { force: true }).catch(() => {});
    });
    await waitForSocket(wettySocketPath, child);
    if (existed !== 0 && record) await startRecording(kind, name);
    return { child, socketPath: wettySocketPath };
  })();
  sessions.set(key, pending);
  try {
    const ready = await pending;
    sessions.set(key, ready);
    return ready;
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
}

function safeHost(value) {
  const candidate = String(value ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '');
  return allowedHosts.has(candidate);
}

function safeOrigin(request) {
  const value = request.headers.origin;
  if (!value) return true;
  try {
    return new URL(value).host === request.headers.host;
  } catch {
    return false;
  }
}

// Parses /focus/owner-terminal/<kind>/<name>/... and pulls the token header. Never
// trusts the token's own `kind` claim over the URL -- verifyToken checks both
// agree. A malformed path or an unknown kind/name is rejected before the token is
// even looked at.
function requestTarget(request) {
  if (!safeHost(request.headers.host) || !safeOrigin(request)) return { status: 403 };
  const url = new URL(request.url, 'http://owner-terminal.invalid');
  if (url.pathname.includes('%') || url.pathname.includes('\\') || url.pathname.includes('//')) {
    return { status: 400 };
  }
  const match = url.pathname.match(
    /^\/focus\/owner-terminal\/([a-z0-9-]+)\/([a-z0-9][a-z0-9-]{0,31})(?:\/|$)/,
  );
  if (!match) return { status: 404 };
  const [, kind, name] = match;
  if (!KINDS.has(kind) || !slugFrom(name)) return { status: 400 };
  const token = request.headers['x-owner-terminal-token'];
  return { kind, name, upstreamPath: url.pathname.slice(`/focus/owner-terminal/${kind}`.length) || '/', token };
}

function upstreamHeaders(headers) {
  const result = { ...headers };
  delete result.cookie;
  delete result.authorization;
  delete result['x-owner-terminal-token'];
  return result;
}

function downstreamHeaders(headers) {
  const result = { ...headers };
  const csp = result['content-security-policy'];
  if (typeof csp === 'string') {
    result['content-security-policy'] = csp
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value && value.toLowerCase() !== 'upgrade-insecure-requests')
      .join('; ');
  }
  if (String(result['content-type'] ?? '')
    .toLowerCase()
    .includes('text/html')) {
    delete result.etag;
    result['cache-control'] = 'no-store';
  }
  return result;
}

async function resolveSession(target) {
  if (target.status) return target;
  const payload = await verifyToken(target.token, target.kind);
  if (!payload) return { status: 403 };
  const record = Boolean(payload.record);
  try {
    const terminal = await session(target.kind, target.name, record);
    return { ...target, terminal };
  } catch {
    return { status: 502 };
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const resolved = await resolveSession(requestTarget(request));
    if (resolved.status) {
      response.writeHead(resolved.status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      return response.end(JSON.stringify({ error: 'owner terminal request rejected' }));
    }
    const upstream = http.request(
      {
        socketPath: resolved.terminal.socketPath,
        path: resolved.upstreamPath,
        method: request.method,
        headers: upstreamHeaders(request.headers),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, downstreamHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  } catch {
    response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'owner terminal unavailable' }));
  }
});

server.on('upgrade', async (request, client, head) => {
  try {
    const resolved = await resolveSession(requestTarget(request));
    if (resolved.status) return client.destroy();
    const upstream = net.createConnection(resolved.terminal.socketPath);
    upstream.once('connect', () => {
      const headers = upstreamHeaders(request.headers);
      upstream.write(`${request.method} ${resolved.upstreamPath} HTTP/${request.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) {
          upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
        }
      }
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
  } catch {
    client.destroy();
  }
});

function stop() {
  server.close();
  for (const value of sessions.values()) {
    Promise.resolve(value)
      .then((item) => item.child.kill('SIGTERM'))
      .catch(() => {});
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await rm(socketPath, { force: true });
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  server.listen(socketPath, async () => {
    await fixSocketOwnership();
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

export {
  requestTarget,
  verifyToken,
  slugFrom,
  upstreamHeaders,
  downstreamHeaders,
  KINDS,
};
