import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GatewayDispatcher,
  PatchrightGatewaySession,
  ProjectBrowserLocks,
  type HelenaClient,
} from '../src/index';

const site = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/second')
      return new Response('<!doctype html><title>Second page</title><h1>Second page</h1>', {
        headers: { 'content-type': 'text/html' },
      });
    return new Response(
      `<!doctype html><title>Harmless tools fixture</title><h1>First page</h1>
  <button draggable="true" id="source">Drag source</button><button id="target" style="margin:40px;width:150px;height:90px">Drop target</button>
  <button id="dialog">Open dialog</button><p id="result">Waiting</p><a href="/second">Second page</a>
  <script>const source=document.getElementById('source'), target=document.getElementById('target'), result=document.getElementById('result'), dialog=document.getElementById('dialog');source.ondragstart=e=>{e.dataTransfer.setData('text/plain','fixture');result.textContent='Drag started';};target.ondragover=e=>e.preventDefault();target.ondrop=e=>{e.preventDefault();result.textContent='Drop succeeded';};dialog.onclick=()=>{result.textContent=confirm('Harmless fixture?')?'Dialog accepted':'Dialog dismissed';};result.textContent='Scripts ready';</script>`,
      { headers: { 'content-type': 'text/html' } },
    );
  },
});
const profile = await mkdtemp(join(tmpdir(), 'volition-browser-211-'));
const browser = spawn(
  '/usr/bin/chromium',
  [
    '--remote-debugging-port=0',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: true },
);
let cdpPort = '';
for (let i = 0; i < 100; i++) {
  cdpPort = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
    .then((text) => text.split('\n')[0]!)
    .catch(() => '');
  if (cdpPort) break;
  await Bun.sleep(50);
}
assert.ok(cdpPort, 'Chromium started its private CDP listener');
const session = await PatchrightGatewaySession.connect(`http://127.0.0.1:${cdpPort}`, {
  humanInput: true,
});
const helena = {
  resolve: async () => ({
    agentId: 211,
    agentName: 'fixture',
    teamId: 1,
    projectId: 1,
    projectKey: 'TEST',
    browserGatewayEnabled: true,
    settings: {
      domainBlocklist: [],
      domainAllowlist: [],
      humanInput: true,
      lockTimeoutSec: 120,
      allowLocalAddresses: true,
    },
  }),
  previews: async () => [],
  audit: async () => {},
  decide: async () => ({ effect: 'allow', reason: 'fixture' }),
  policy: async () => ({}),
} as unknown as HelenaClient;
const gateway = new GatewayDispatcher({
  ownSlug: 'fixture',
  helena,
  locks: new ProjectBrowserLocks(120000),
  sessions: { get: async () => session },
});
async function call(tool: string, args: Record<string, unknown> = {}) {
  const result = await gateway.handle({ tool, args, agentKey: 'test-key' });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.content : '';
}
function ref(snapshot: string, name: string) {
  const line = snapshot.split('\n').find((line) => line.includes(`"${name}"`));
  const id = line?.match(/\[ref=([a-z0-9]+)\]/)?.[1];
  assert.ok(id, `${name}: ${snapshot}`);
  return id;
}
try {
  await call('browser_navigate', { url: site.url.toString() });
  session.taskPage();
  await Bun.sleep(200);
  let snapshot = await call('browser_snapshot');
  await call('browser_drag', {
    startTarget: ref(snapshot, 'Drag source'),
    endTarget: ref(snapshot, 'Drop target'),
  });
  assert.match(await call('browser_snapshot'), /Drop succeeded/);
  console.log('PASS browser_drag: actual HTML drag and drop');
  snapshot = await call('browser_snapshot');
  const dialog = await call('browser_click', { target: ref(snapshot, 'Open dialog') });
  assert.match(dialog, /browser_handle_dialog/);
  await call('browser_handle_dialog', { accept: true });
  assert.match(await call('browser_snapshot'), /Dialog accepted/);
  console.log('PASS browser_handle_dialog: confirm accepted');
  await call('browser_navigate', { url: new URL('/second', site.url).toString() });
  await call('browser_navigate_back');
  assert.match(await call('browser_snapshot'), /First page/);
  console.log('PASS browser_navigate_back: first page restored');
  await call('browser_tabs', { action: 'new', url: new URL('/second', site.url).toString() });
  assert.match(await call('browser_tabs', { action: 'list' }), /Second page/);
  await call('browser_release');
  assert.doesNotMatch(await call('browser_tabs', { action: 'list' }), /Second page/);
  assert.match(await call('browser_tabs', { action: 'list' }), /Harmless tools fixture/);
  console.log('PASS tabs: owner tab preserved; agent tab closed on release as specified');
} finally {
  if (browser.pid) process.kill(-browser.pid, 'SIGTERM');
  await Bun.sleep(200);
  await rm(profile, { recursive: true, force: true });
  site.stop(true);
}
