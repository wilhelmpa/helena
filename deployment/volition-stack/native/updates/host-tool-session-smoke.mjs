import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [tool, binary] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const installedLauncher = path.join(here, 'wetty-local-command.mjs');
const launcher = existsSync(installedLauncher)
  ? installedLauncher
  : path.join(here, '../terminal/wetty-local-command.mjs');
const directory = await mkdtemp(path.join(tmpdir(), 'volition-host-session-'));
const socket = path.join(directory, 'session.sock');
const env = {
  ...process.env,
  HOME: directory,
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
};
/** @type {{child?: import('node:child_process').ChildProcess, client?: import('socket.io-client', {with: {'resolution-mode': 'require'}}).Socket, proxy?: import('node:http').Server}} */
const state = {};

async function waitForSocket() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (state.child.exitCode !== null) throw new Error(`${tool} exited before listening`);
    if (
      await stat(socket)
        .then((entry) => entry.isSocket())
        .catch(() => false)
    )
      return;
    await delay(25);
  }
  throw new Error(`${tool} did not open its private socket`);
}

async function wettySmoke() {
  const shell = path.join(directory, 'shell');
  await writeFile(shell, "#!/bin/sh\nPS1='volition-wetty-ready> '\nexport PS1\nexec /bin/sh -i\n");
  state.child = spawn(
    process.execPath,
    [
      launcher,
      '--wetty',
      binary,
      '--socket',
      socket,
      '--base',
      '/smoke',
      '--command',
      `/bin/sh ${shell}`,
    ],
    { cwd: directory, env, stdio: 'ignore' },
  );
  state.child.on('error', () => {});
  await waitForSocket();
  // Match the routers' WebSocket forwarding from loopback into WeTTY's private socket.
  state.proxy = http.createServer();
  state.proxy.on('upgrade', (request, downstream, head) => {
    const upstream = net.connect(socket, () => {
      const headers = Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`);
      upstream.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
      );
      upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
    upstream.on('error', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    downstream.on('close', () => upstream.destroy());
  });
  await new Promise((resolve) => state.proxy.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = state.proxy.address();
  if (!address || typeof address === 'string') throw new Error('Smoke proxy did not bind loopback');
  const url = `http://127.0.0.1:${address.port}`;
  const require = createRequire(await realpath(binary));
  const { io } = require('socket.io-client');
  state.client = io(url, {
    path: '/smoke/socket.io',
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Origin: url },
  });
  await new Promise((resolve, reject) => {
    let output = '';
    let sent = false;
    const timer = setTimeout(() => reject(new Error('WeTTY shell prompt/command timed out')), 5000);
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    state.client.on('connect_error', () => fail(new Error('WeTTY WebSocket connection failed')));
    state.client.on('logout', () =>
      fail(new Error('WeTTY shell exited before the smoke completed')),
    );
    state.client.on('data', (data) => {
      output = (output + data).slice(-16384);
      state.client.emit('commit', data.length);
      if (/enter your user\s?name|login:|password:/i.test(output)) {
        fail(new Error('WeTTY requested login instead of starting the local shell'));
      } else if (!sent && output.includes('volition-wetty-ready> ')) {
        sent = true;
        state.client.emit('input', "printf 'volition-%s\\n' 'session-ok'\n");
      } else if (sent && output.includes('volition-session-ok')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
  });
}

async function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: socket, path: urlPath }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body = (body + chunk).slice(0, 256 * 1024);
      });
      response.on('error', reject);
      response.on('end', () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode, body });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('HTTP smoke timed out')), 1000);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function codeSmoke() {
  state.child = spawn(
    binary,
    [
      '--auth',
      'none',
      '--socket',
      socket,
      '--user-data-dir',
      directory,
      '--extensions-dir',
      path.join(directory, 'extensions'),
      '--disable-telemetry',
      '--disable-update-check',
      directory,
    ],
    { cwd: directory, env, stdio: 'ignore' },
  );
  state.child.on('error', () => {});
  await waitForSocket();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null)
      throw new Error('code-server exited before serving the workbench');
    const health = await request('/healthz').catch(() => null);
    const page = await request('/?folder=' + encodeURIComponent(directory)).catch(() => null);
    if (health?.status === 200 && page?.status === 200 && /workbench/i.test(page.body)) return;
    await delay(100);
  }
  throw new Error('code-server did not serve its health endpoint and workbench');
}

try {
  if (tool === 'wetty') await wettySmoke();
  else if (tool === 'code-server') await codeSmoke();
  else throw new Error('Unknown session smoke');
  console.log(`${tool} session smoke passed`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  state.client?.close();
  state.proxy?.close();
  if (state.child && state.child.exitCode === null && state.child.pid) {
    const exited = new Promise((resolve) => state.child.once('exit', resolve));
    state.child.kill('SIGTERM');
    const timer = setTimeout(() => state.child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
