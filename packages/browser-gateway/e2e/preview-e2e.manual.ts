import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GatewayDispatcher,
  PatchrightGatewaySession,
  ProjectBrowserLocks,
  type HelenaClient,
} from '../src/index.ts';
import type { ManagedPreview } from '../src/helena-client.ts';

type Preview = ManagedPreview & { cwd: string; command: string };
const profile = await mkdtemp(join(tmpdir(), 'volition-preview-browser-'));
const servers: ReturnType<typeof Bun.serve>[] = [];
const entries: Preview[] = [];
const chromium = Bun.spawn(
  [
    '/usr/bin/chromium',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

function startPreview(name: string, cwd: string, command: string, heading: string): Preview {
  const existing = entries.find(
    (entry) =>
      entry.status === 'running' &&
      (entry.name === name || (entry.cwd === cwd && entry.command === command)),
  );
  if (existing) return existing;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response(
        `<html><head><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`,
        { headers: { 'content-type': 'text/html' } },
      ),
  });
  servers.push(server);
  const entry: Preview = {
    name,
    status: 'running',
    url: `http://127.0.0.1:${server.port}`,
    cwd,
    command,
    lines: [`astro ready on ${server.port}`],
  };
  entries.push(entry);
  return entry;
}

async function cdpPort() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const port = Number(
        (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      );
      if (port > 0) return port;
    } catch {
      /* Chromium is starting. */
    }
    await Bun.sleep(100);
  }
  throw new Error('Chromium CDP did not start');
}

try {
  const port = await cdpPort();
  const first = startPreview('homepage-dev', 'homepage/homepage', 'astro dev', 'Astro preview one');
  const second = startPreview('other', 'other', 'astro dev', 'Astro preview two');
  entries.unshift({ ...first, name: 'old', status: 'stopped', lines: ['old server stopped'] });
  const helena = {
    resolve: async () => ({
      agentId: 1,
      agentName: 'preview-test',
      teamId: 1,
      projectId: 1,
      projectKey: 'VOL',
      browserGatewayEnabled: true,
      settings: {
        domainBlocklist: [],
        domainAllowlist: [],
        humanInput: true,
        lockTimeoutSec: 120,
        allowLocalAddresses: false,
      },
    }),
    decide: async () => ({ effect: 'allow', reason: 'test' }),
    audit: async () => {},
    previews: async () => entries,
  } as unknown as HelenaClient;
  const session = await PatchrightGatewaySession.connect(`http://127.0.0.1:${port}`, {
    humanInput: true,
    onDownload: async () => 'unused',
    getPreviewOrigins: async () =>
      entries.filter((entry) => entry.status === 'running').map((entry) => entry.url),
  });
  const gateway = new GatewayDispatcher({
    ownSlug: 'vol',
    helena,
    locks: new ProjectBrowserLocks(120_000),
    sessions: { get: async () => session },
  });
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    gateway.handle({ tool, args, agentKey: 'test' });
  for (const [entry, heading] of [
    [first, 'Astro preview one'],
    [second, 'Astro preview two'],
  ] as const) {
    const navigate = await call('browser_navigate', { url: entry.url });
    if (!navigate.ok) throw new Error(navigate.error);
    const snapshot = await call('browser_snapshot');
    if (!snapshot.ok || !snapshot.content.includes(heading))
      throw new Error(`browser_snapshot did not show ${heading}`);
  }
  if (
    startPreview('astro', 'homepage/homepage', 'astro dev', 'duplicate') !== first ||
    servers.length !== 2
  )
    throw new Error('A repeated preview_start created another server');
  first.status = 'stopped';
  servers[0]!.stop(true);
  const stopped = await call('browser_navigate', { url: first.url });
  if (
    stopped.ok ||
    stopped.state?.type !== 'preview-unreachable' ||
    stopped.state.reason !== 'stopped'
  )
    throw new Error('Navigation after preview_stop did not report stopped');
  console.log(
    'PASS preview_start -> browser_navigate -> browser_snapshot -> reuse -> stop -> stopped',
  );
} finally {
  for (const server of servers) server.stop(true);
  chromium.kill();
  await chromium.exited;
  await rm(profile, { recursive: true, force: true });
}
