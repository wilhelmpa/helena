import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';

// The control lock end to end, across projects (design §5, §9.5–9.6), with everything real
// but the browser: Helena's internal routes and database, the gateway's Plan client, one
// dispatcher per project socket on real Unix sockets (the router's own connection handler),
// the shared lock registry, and the agents' side of the wire (the MCP shim's protocol). A
// fake page stands in for Chromium, which the lock never touches.
//
// The gateway's modules are loaded at run time by path: they are the browser router's code
// (Node, DOM types for the page scripts), not part of this API's program.

const GATEWAY_TOKEN = 'test-browser-gateway-token-locks-0123456789abcdef';
const ROOT = resolve(import.meta.dir, '../../../../../../..');

/* eslint-disable @typescript-eslint/no-explicit-any -- modules loaded by path, untyped here */
let gateway: any;
let glue: any;
let shim: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-gateway-locks-'));
  const file = join(directory, 'token');
  writeFileSync(file, GATEWAY_TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
  gateway = await import(join(ROOT, 'packages/browser-gateway/src/index.ts'));
  shim = await import(join(ROOT, 'packages/browser-gateway/src/shim-protocol.ts'));
  glue = await import(join(ROOT, 'deployment/volition-stack/browser/browser-gateway-server.mjs'));
});

interface Page {
  actions: string[];
}

// The stand-in for a project's browser: records what it was asked to do.
function fakeSession(page: Page) {
  const done = async (what: string) => {
    page.actions.push(what);
    return what;
  };
  return {
    guard: new gateway.SecretGuard(),
    isConnected: () => true,
    setHumanInput: () => {},
    applyDomainPolicy: async () => {},
    status: async () => ({
      url: 'https://example.com/',
      title: 'Example',
      tabCount: 1,
      dialogOpen: false,
    }),
    navigate: (url: string) => done(`navigate ${url}`),
    snapshot: () => done('snapshot'),
    click: (ref: string) => done(`click ${ref}`),
    closeTabsOf: async () => {},
    submitsForm: async () => ({ submits: false, formAction: null }),
    pageOrigin: () => 'https://example.com',
  };
}

let sockets: net.Server[] = [];
let socketRoot: string;

afterEach(() => {
  for (const server of sockets) server.close();
  sockets = [];
  if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
});

// One gateway, as the router runs it: shared locks and queue, a dispatcher per socket.
async function startGateway(slugs: string[]) {
  socketRoot = mkdtempSync(join(tmpdir(), 'gw-sockets-'));
  const helena = new gateway.HelenaClient({
    baseUrl: 'http://localhost',
    serviceToken: GATEWAY_TOKEN,
    fetchImpl: (url: string, init: RequestInit) => app.handle(new Request(url, init)),
  });
  const locks = new gateway.ProjectBrowserLocks(120_000);
  const queue = new gateway.SlugQueue();
  const pages = new Map<string, Page>();
  const sessions = {
    get: async (slug: string) => {
      if (!pages.has(slug)) pages.set(slug, { actions: [] });
      return fakeSession(pages.get(slug)!);
    },
  };
  const paths: Record<string, string> = {};
  for (const slug of slugs) {
    const dispatcher = new gateway.GatewayDispatcher({
      ownSlug: slug,
      helena,
      locks,
      sessions,
      queue,
    });
    const path = join(socketRoot, `${slug}.sock`);
    const server = net.createServer((socket) => glue.handleConnection(socket, dispatcher));
    await new Promise<void>((done) => server.listen(path, () => done()));
    sockets.push(server);
    paths[slug] = path;
  }
  // What an agent's shim does: one call over the socket its unit was given.
  const call = async (
    socket: string,
    agentKey: string,
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; text: string }> => {
    const result = await shim.callGateway(tool, args, {
      socketPath: paths[socket],
      env: { ITSAPLAN_API_KEY: agentKey },
    });
    return {
      ok: !result.isError,
      text: result.content.map((part: { text?: string }) => part.text ?? '').join(''),
    };
  };
  return { call, locks, pages };
}

const servers = (api: Api, teamId: number) => api.teams({ teamId })['mcp-servers'];
const agentServers = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId })['mcp-servers'];

async function world() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('no Home agent');
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
  const teamId = mkt.teamId;
  const server = (await servers(asOwner, teamId).get()).data!.find(
    (row) => row.name === 'projekt-browser',
  )!;
  const agent = async (projectKey: string, username: string) => {
    const created = await createAgent(asOwner, projectKey, {
      name: username,
      username,
      kind: 'external',
    });
    const id = created.data!.agent.id;
    await agentServers(asOwner, teamId, id).put({ mcpServerIds: [server.id] });
    return created.data!.apiKey! as string;
  };
  await agentServers(asOwner, teamId, home.agentId).put({ mcpServerIds: [server.id] });
  return {
    asOwner,
    writer: await agent('MKT', 'writer'),
    coder: await agent('MKT', 'coder'),
    ops: await agent('OPS', 'opsbot'),
    master: home.apiKey,
  };
}

describe('browser gateway: control lock across agents, projects and the Home-Master', () => {
  beforeEach(resetDb);

  it('one holder per browser, FIFO waiting, per-project locks, Home-Master everywhere, owner first', async () => {
    const { asOwner, writer, coder, ops, master } = await world();
    const { call, locks, pages } = await startGateway(['mkt', 'ops', 'home']);

    // Two agents of one project: the first holds, the second is refused at once.
    const first = await call('mkt', writer, 'browser_acquire');
    expect(first.text).toBe('Control acquired. Call browser_snapshot to see the page.');
    const refused = await call('mkt', coder, 'browser_acquire', { timeoutSec: 0 });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain('Still controlled by writer');
    const notHeld = await call('mkt', coder, 'browser_click', { ref: 'e1' });
    expect(notHeld.text).toContain('writer controls it');

    // The second waits, and gets it the moment the first gives it back.
    const waiting = call('mkt', coder, 'browser_acquire', { timeoutSec: 10 });
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (await call('mkt', writer, 'browser_navigate', { url: 'https://example.com/a' })).ok,
    ).toBe(true);
    expect((await call('mkt', writer, 'browser_release')).ok).toBe(true);
    expect((await waiting).ok).toBe(true);
    expect((await call('mkt', coder, 'browser_click', { ref: 'e2' })).ok).toBe(true);

    // Another project's browser has a lock of its own.
    expect((await call('ops', ops, 'browser_acquire', { timeoutSec: 0 })).ok).toBe(true);

    // Nobody but the Home-Master names another project, and every socket keeps to its own.
    const across = await call('ops', ops, 'browser_status', { project: 'MKT' });
    expect(across.ok).toBe(false);
    expect(across.text).toContain('Only the Home-Master');
    expect((await call('mkt', ops, 'browser_status')).text).toContain(
      'does not work in this project',
    );
    expect((await call('home', writer, 'browser_status')).text).toContain(
      "Only the Home-Master uses Home's browser",
    );
    expect((await call('mkt', master, 'browser_status')).text).toContain(
      "uses Home's browser gateway",
    );

    // The Home-Master sees who holds a project's browser and waits its turn like anyone.
    expect((await call('home', master, 'browser_status', { project: 'MKT' })).text).toContain(
      'Controlled by: coder.',
    );
    expect(
      (await call('home', master, 'browser_acquire', { project: 'MKT', timeoutSec: 0 })).ok,
    ).toBe(false);
    expect((await call('ops', ops, 'browser_release')).ok).toBe(true);
    expect(
      (await call('home', master, 'browser_acquire', { project: 'OPS', timeoutSec: 0 })).ok,
    ).toBe(true);
    expect(
      (
        await call('home', master, 'browser_navigate', {
          project: 'OPS',
          url: 'https://example.com/ops',
        })
      ).ok,
    ).toBe(true);
    // Its own browser, too.
    expect((await call('home', master, 'browser_acquire', { timeoutSec: 0 })).ok).toBe(true);
    expect((await call('home', master, 'browser_snapshot')).ok).toBe(true);

    // Übernehmen: the owner wins at once; the agent waits until Zurückgeben.
    locks.of('mkt').takeover();
    const blocked = await call('mkt', coder, 'browser_click', { ref: 'e3' });
    expect(blocked.text).toContain('The owner controls it');
    const back = call('mkt', coder, 'browser_acquire', { timeoutSec: 10 });
    await new Promise((r) => setTimeout(r, 50));
    locks.of('mkt').release({ kind: 'owner' });
    expect((await back).ok).toBe(true);

    // Each browser got exactly its own actions.
    expect(pages.get('mkt')!.actions).toEqual(['navigate https://example.com/a', 'click e2']);
    expect(pages.get('ops')!.actions).toEqual(['navigate https://example.com/ops']);
    expect(pages.get('home')!.actions).toEqual(['snapshot']);

    // And the audit is in each project, naming who acted (fire-and-forget: give it a moment).
    await new Promise((r) => setTimeout(r, 200));
    const mktEvents = await asOwner.projects({ projectKey: 'MKT' })['browser-gateway'].events.get();
    const opsEvents = await asOwner.projects({ projectKey: 'OPS' })['browser-gateway'].events.get();
    expect(mktEvents.data!.items.map((item) => `${item.agentName} ${item.tool}`).reverse()).toEqual(
      ['writer browser_navigate', 'coder browser_click'],
    );
    expect(opsEvents.data!.items.map((item) => `${item.agentName} ${item.tool}`)).toEqual([
      'Home browser_navigate',
    ]);
  });
});
