#!/usr/bin/env node
// Loads pages of the live web app in a headless Chromium and fails on what a green gate does
// not show: an uncaught exception, a script that did not load, Next's error page (on
// 2026-09-27 a component crashed every page for 20 minutes while all tests passed). deploy.sh
// runs it after every deployment; it runs on its own as well:
//
//   node web-smoke.mjs --base https://helena.example --resolve 127.0.0.1 \
//     [--api http://127.0.0.1:3000] [--chromium /usr/bin/chromium] path...
//
// --resolve sends the base's host name to that address (nginx on this machine), so the pages
// load exactly as a browser at home gets them. With HELENA_SMOKE_LOCAL_TOKEN set (the LAN
// owner sign-in's capability, packages/auth local-owner.ts), it signs in as the owner first,
// so the pages behind the sign-in are checked too, and signs out again at the end. No
// dependencies: Node's own fetch and WebSocket speak to Chromium's DevTools protocol.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const SETTLE_MS = 3_000;
const LOAD_TIMEOUT_MS = 30_000;

export function parseArgs(argv) {
  const options = { chromium: '/usr/bin/chromium', api: null, resolve: null, base: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') options.base = argv[++i];
    else if (arg === '--api') options.api = argv[++i];
    else if (arg === '--resolve') options.resolve = argv[++i];
    else if (arg === '--chromium') options.chromium = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.paths.push(arg);
  }
  if (!options.base) throw new Error('--base is required');
  options.base = new URL(options.base).origin;
  if (options.paths.length === 0) options.paths = ['/'];
  return options;
}

// What one page load showed; `problems` empty means it rendered cleanly.
export function judge({ path, finalUrl, base, exceptions, failedScripts, bodyText, signedIn }) {
  const problems = [];
  for (const text of exceptions) problems.push(`uncaught exception: ${text}`);
  for (const url of failedScripts) problems.push(`script did not load: ${url}`);
  if (/Application error: a (client|server)-side exception has occurred/i.test(bodyText ?? ''))
    problems.push("Next's error page");
  const landed = finalUrl ? new URL(finalUrl) : null;
  if (!landed || landed.origin !== base) problems.push(`ended outside the app: ${finalUrl}`);
  else if (signedIn && path !== '/login' && landed.pathname === '/login')
    problems.push('sent to the sign-in although signed in');
  return problems;
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('DevTools connection failed')), {
        once: true,
      });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.socket.close();
  }
}

async function devToolsUrl(profile, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chromium exited (${child.exitCode})`);
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch {
      // Not written yet.
    }
    await sleep(100);
  }
  throw new Error('Chromium did not open its DevTools port');
}

// Signs in as the LAN owner through the API, as the web app's proxy does; the cookies it
// sets, for the browser. Null when this instance has no LAN owner.
async function ownerCookies(api, base, token) {
  const response = await fetch(`${api}/api/auth/sign-in/local-owner`, {
    method: 'POST',
    headers: { 'x-volition-local-access': token, origin: base, 'user-agent': 'helena-web-smoke' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error(`web-smoke: no owner sign-in (${response.status}); checking signed out only`);
    return null;
  }
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.includes('session_token='));
}

async function signOut(api, base, cookies) {
  await fetch(`${api}/api/auth/sign-out`, {
    method: 'POST',
    headers: { cookie: cookies.join('; '), origin: base, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.HELENA_SMOKE_LOCAL_TOKEN;
  const cookies = token && options.api ? await ownerCookies(options.api, options.base, token) : null;
  const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'helena-web-smoke-'));
  const host = new URL(options.base).hostname;
  const args = [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    // The certificate names the public host; the check talks to this machine's nginx.
    '--ignore-certificate-errors',
    ...(options.resolve ? [`--host-resolver-rules=MAP ${host} ${options.resolve}`] : []),
    'about:blank',
  ];
  const child = spawn(options.chromium, args, { stdio: 'ignore' });
  let failures = 0;
  let cdp;
  try {
    cdp = new Cdp(await devToolsUrl(profile, child));
    await cdp.opened;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Network.enable');
    for (const pair of cookies ?? []) {
      const at = pair.indexOf('=');
      await page('Network.setCookie', {
        name: pair.slice(0, at),
        value: pair.slice(at + 1),
        url: options.base,
        httpOnly: true,
        secure: options.base.startsWith('https:'),
        sameSite: 'Lax',
      });
    }
    for (const path of options.paths) {
      const exceptions = [];
      const failedScripts = [];
      const scripts = new Map();
      let loaded = false;
      const listener = (message) => {
        if (message.sessionId !== sessionId) return;
        const { method, params } = message;
        if (method === 'Runtime.exceptionThrown') {
          const details = params.exceptionDetails;
          exceptions.push(details.exception?.description?.split('\n')[0] ?? details.text);
        } else if (method === 'Network.requestWillBeSent' && params.type === 'Script') {
          scripts.set(params.requestId, params.request.url);
        } else if (method === 'Network.responseReceived' && scripts.has(params.requestId)) {
          if (params.response.status >= 400) failedScripts.push(`${params.response.url} (${params.response.status})`);
        } else if (method === 'Network.loadingFailed' && scripts.has(params.requestId)) {
          if (!params.canceled) failedScripts.push(`${scripts.get(params.requestId)} (${params.errorText})`);
        } else if (method === 'Page.loadEventFired') loaded = true;
      };
      cdp.listeners.add(listener);
      await page('Page.navigate', { url: options.base + path });
      const deadline = Date.now() + LOAD_TIMEOUT_MS;
      while (!loaded && Date.now() < deadline) await sleep(100);
      await sleep(SETTLE_MS);
      cdp.listeners.delete(listener);
      const evaluated = await page('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: location.href, text: document.body ? document.body.innerText.slice(0, 2000) : "" })',
        returnByValue: true,
      });
      const { url, text } = JSON.parse(evaluated.result.value);
      const problems = loaded
        ? judge({ path, finalUrl: url, base: options.base, exceptions, failedScripts, bodyText: text, signedIn: Boolean(cookies?.length) })
        : [`did not finish loading within ${LOAD_TIMEOUT_MS / 1000}s`];
      if (problems.length === 0) console.log(`web-smoke: ${path} ok (${new URL(url).pathname})`);
      else {
        failures++;
        for (const problem of problems) console.error(`web-smoke: ${path}: ${problem}`);
      }
    }
  } finally {
    cdp?.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
    // Chromium's helpers can still be writing the profile for a moment after it exits.
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    if (cookies?.length) await signOut(options.api, options.base, cookies);
  }
  if (failures > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`web-smoke: ${error.message}`);
    process.exit(1);
  });
}
