import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const host = process.env.TERMINAL_HOST ?? '127.0.0.1';
const port = Number(process.env.TERMINAL_PORT ?? 8444);
const projectsRoot = process.env.PROJECTS_ROOT ?? '/srv/volition/workspaces/projects';
const runtimeRoot = process.env.TERMINAL_RUNTIME_ROOT ?? '/run/volition-terminal';
const wetty = process.env.WETTY_BIN ?? '/usr/local/bin/wetty';
const shell = process.env.TERMINAL_SHELL ?? '/usr/local/libexec/volition-terminal-shell';
const tmux = process.env.TMUX_BIN ?? '/usr/bin/tmux';
const sweepIntervalMs = Number(process.env.TERMINAL_SWEEP_INTERVAL_MS ?? 60_000);
const run = promisify(execFile);
const publicPrefix = '/focus/terminal-project';
const allowedHosts = new Set((process.env.TERMINAL_ALLOWED_HOSTS ?? 'kingston-server.local,kingston-server')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
const sessions = new Map();

function safeHost(value) {
  const candidate = String(value ?? '').toLowerCase().replace(/:\d+$/, '');
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

function slugFrom(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value) ? value : null;
}

async function projectDirectory(slug) {
  // Home is no project of its own: its terminal opens where the Home agent works.
  if (slug === 'home') return realpath(isolated ? path.join(path.dirname(projectsRoot), 'home') : path.dirname(projectsRoot));
  const root = await realpath(projectsRoot);
  const candidate = path.join(root, slug);
  const stat = await lstat(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid project directory');
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('project directory escapes root');
  return resolved;
}

async function projectExists(slug) {
  try {
    await projectDirectory(slug);
    return true;
  } catch {
    return false;
  }
}

// terminal-shell names each project's tmux session volition-<slug>.
function tmuxSessionSlugs(output) {
  return output.split('\n').flatMap(name => {
    const slug = name.startsWith('volition-') ? slugFrom(name.slice('volition-'.length)) : null;
    return slug ? [slug] : [];
  });
}

async function removedProjects(candidates, exists = projectExists) {
  const removed = [];
  for (const slug of new Set(candidates)) {
    if (!(await exists(slug))) removed.push(slug);
  }
  return removed;
}

// With agent isolation the project's tmux runs in a unit of its own, as the project's user;
// only the launcher can stop it.
const isolated = process.env.AGENT_ISOLATION === 'on';
const launchClient = process.env.LAUNCH_CLIENT ?? '/usr/local/lib/volition-isolation/launch_client.py';

async function stopProject(slug) {
  const current = sessions.get(slug);
  sessions.delete(slug);
  if (current) Promise.resolve(current).then(item => item.child.kill('SIGTERM')).catch(() => {});
  if (isolated) {
    await run('/usr/bin/python3', ['-I', launchClient, 'terminal-stop', slug]).catch(() => {});
    return;
  }
  await run(tmux, ['kill-session', '-t', `=volition-${slug}`]).catch(() => {});
}

// Deleting a project moves its workspace to the trash. Its Wetty and tmux session
// run inside this service's private /tmp, so only this router can stop them.
async function stopRemovedProjects() {
  const { stdout } = await run(tmux, ['list-sessions', '-F', '#{session_name}']).catch(() => ({ stdout: '' }));
  for (const slug of await removedProjects([...sessions.keys(), ...tmuxSessionSlugs(stdout)])) {
    await stopProject(slug);
  }
}

async function waitForSocket(socketPath, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Wetty exited before opening its socket');
    try {
      const stat = await lstat(socketPath);
      if (stat.isSocket()) return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Wetty did not open its socket');
}

async function session(slug) {
  if (!(await projectExists(slug))) {
    await stopProject(slug);
    throw new Error('project directory unavailable');
  }
  const current = sessions.get(slug);
  if (current) return current;
  const pending = (async () => {
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    const socketPath = path.join(runtimeRoot, `${slug}.sock`);
    await rm(socketPath, { force: true });
    const base = `${publicPrefix}/${slug}`;
    const child = spawn(wetty, [
      '--socket', socketPath,
      '--base', base,
      '--command', `${shell} ${slug}`,
      '--allow-iframe',
      '--log-level', 'warn',
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('exit', () => {
      if (sessions.get(slug)?.child === child) sessions.delete(slug);
      rm(socketPath, { force: true }).catch(() => {});
    });
    await waitForSocket(socketPath, child);
    return { child, socketPath };
  })();
  sessions.set(slug, pending);
  try {
    const ready = await pending;
    sessions.set(slug, ready);
    return ready;
  } catch (error) {
    sessions.delete(slug);
    throw error;
  }
}

function requestTarget(request) {
  if (!safeHost(request.headers.host) || !safeOrigin(request)) return { status: 403 };
  const url = new URL(request.url, 'http://terminal.invalid');
  if (url.pathname === publicPrefix) {
    if ([...url.searchParams.keys()].some(key => key !== 'arg')) return { status: 400 };
    const slug = slugFrom(url.searchParams.get('arg'));
    return slug ? { slug, upstreamPath: `${publicPrefix}/${slug}` } : { status: 400 };
  }
  if (url.pathname === `${publicPrefix}/`) {
    if ([...url.searchParams.keys()].some(key => key !== 'arg')) return { status: 400 };
    const slug = slugFrom(url.searchParams.get('arg'));
    return slug ? { redirect: `${publicPrefix}/${slug}/` } : { status: 400 };
  }
  if (url.pathname.includes('%') || url.pathname.includes('\\') || url.pathname.includes('//')) return { status: 400 };
  const match = url.pathname.match(/^\/focus\/terminal-project\/([a-z0-9][a-z0-9-]{0,31})(?:\/|$)/);
  if (!match) return { status: 404 };
  return { slug: match[1] };
}

function upstreamHeaders(headers) {
  const result = { ...headers };
  delete result.cookie;
  delete result.authorization;
  delete result['proxy-authorization'];
  return result;
}

function downstreamHeaders(headers) {
  const result = { ...headers };
  // wetty sets Cross-Origin-Opener-Policy, which a frame never uses and which the browser
  // reports as an error over the plain-http LAN ("header has been ignored").
  delete result['cross-origin-opener-policy'];
  const csp = result['content-security-policy'];
  if (typeof csp === 'string') {
    result['content-security-policy'] = csp.split(';').map(value => value.trim())
      .filter(value => value && value.toLowerCase() !== 'upgrade-insecure-requests').join('; ');
  }
  if (String(result['content-type'] ?? '').toLowerCase().includes('text/html')) {
    delete result.etag;
    result['cache-control'] = 'no-store';
  }
  return result;
}

const server = http.createServer(async (request, response) => {
  try {
    const target = requestTarget(request);
    if (target.redirect) {
      response.writeHead(302, { location: target.redirect, 'cache-control': 'no-store' });
      return response.end();
    }
    if (!target.slug) {
      response.writeHead(target.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return response.end(JSON.stringify({ error: 'terminal route rejected' }));
    }
    const terminal = await session(target.slug);
    const upstream = http.request({
      socketPath: terminal.socketPath,
      path: target.upstreamPath ?? request.url,
      method: request.method,
      headers: upstreamHeaders(request.headers),
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, downstreamHeaders(upstreamResponse.headers));
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  } catch {
    response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'project terminal unavailable' }));
  }
});

server.on('upgrade', async (request, client, head) => {
  try {
    const target = requestTarget(request);
    if (!target.slug) return client.destroy();
    const terminal = await session(target.slug);
    const upstream = net.createConnection(terminal.socketPath);
    upstream.once('connect', () => {
      const headers = upstreamHeaders(request.headers);
      upstream.write(`${request.method} ${target.upstreamPath ?? request.url} HTTP/${request.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
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

let sweep;

function stop() {
  clearInterval(sweep);
  server.close();
  for (const value of sessions.values()) {
    Promise.resolve(value).then(item => item.child.kill('SIGTERM')).catch(() => {});
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  server.listen(port, host);
  sweep = setInterval(() => stopRemovedProjects().catch(() => {}), sweepIntervalMs);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

export { requestTarget, slugFrom, upstreamHeaders, downstreamHeaders, tmuxSessionSlugs, removedProjects };
