import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentRun,
  aiAgent,
  db,
  getSetting,
  helenaSystemJob,
  helenaUpdate,
  helenaUpdateAction,
  helenaModelServer,
} from '@repo/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { setManualPrice } from '#modules/model-prices/service';
import { events } from '#shared/helena';
import { DIGEST_SYSTEM_PROMPT } from '../../digest-prompt';
import { setUpdateFetch } from '../../fetch';
import { runSystemJobNow } from '#modules/engine/system-jobs';
import { runUpdatesJob, UPDATES_JOB_ID } from '../../job';
import {
  applyUpdate,
  collectDigests,
  digestTargets,
  followActions,
  queueDigests,
  runAutoUpdates,
  runUpdateCheck,
} from '../../service';
import { pickDigestModel } from '../../digest';
import { getUpdateSettings, setUpdateSettings } from '../../settings';
import { configuredModelWatch } from '#modules/local-ai/model-watch-config';

// The update center end to end, with the vendors' endpoints and the root helper played by
// the test: what a check stores, the digest runs a Hermes runner claims and answers, and an
// update the owner starts, followed to its end.

let spool = '';
let backups = '';
let fakeHelper: { stop: () => Promise<void> } | null = null;
const helperRequests: Record<string, unknown>[] = [];

const INVENTORY = {
  apt: {
    os: 'Debian GNU/Linux 13 (trixie)',
    listsUpdatedAt: '2026-09-24T08:00:00+00:00',
    refreshedAt: '2026-09-26T21:49:30+00:00',
    refreshAttemptedAt: '2026-09-26T21:49:29+00:00',
    refreshError: null,
    rollbackReady: ['libssl3t64', 'openssl', 'tzdata'],
    packages: [
      {
        source: 'openssl',
        installed: '3.5.1-1',
        candidate: '3.5.1-1+deb13u1',
        origin: 'Debian-Security:13/stable-security',
        security: true,
        packages: ['libssl3t64', 'openssl'],
      },
      {
        source: 'tzdata',
        installed: '2025b-4',
        candidate: '2025c-0+deb13u1',
        origin: 'Debian:13.2/stable',
        security: false,
        packages: ['tzdata'],
      },
    ],
  },
  runtimes: {
    claude: { current: '2.1.281' },
    codex: { current: '0.156.1' },
    'claude-agent-acp': { current: '0.81.1' },
    'codex-acp': { current: '1.13.1' },
  },
  runtimeApply: ['claude', 'codex', 'claude-agent-acp', 'codex-acp'],
  tools: {
    bun: '1.4.2',
    node: '24.21.0',
    'code-server': '4.138.0',
    wetty: '3.2.2',
    kasmvnc: '1.5.0-1',
    chromium: '153.0.8010.52-1~deb13u1',
  },
  system: { rebootRequired: false, failedUnits: [] },
};

function atom(repository: string, tags: [string, string][]): string {
  return `<feed>${tags
    .map(
      ([tag, notes]) =>
        `<entry><updated>2026-09-24T10:00:00Z</updated><link rel="alternate" href="https://github.com/${repository}/releases/tag/${tag}"/><title>${tag}</title><content type="html">&lt;p&gt;${notes}&lt;/p&gt;</content></entry>`,
    )
    .join('')}</feed>`;
}

const VENDOR: Record<string, () => Response> = {
  'https://github.com/ggml-org/whisper.cpp/releases.atom': () =>
    new Response(atom('ggml-org/whisper.cpp', [['v1.9.4', 'Whisper release']])),
  'https://github.com/ggml-org/llama.cpp/releases.atom': () =>
    new Response(atom('ggml-org/llama.cpp', [['b11200', 'Embedding build']])),
  'https://api.github.com/repos/ServeurpersoCom/qwentts.cpp/commits/master': () =>
    Response.json({ sha: 'abcdef1234567890abcdef1234567890abcdef12' }),
  'https://github.com/astral-sh/uv/releases.atom': () =>
    new Response(atom('astral-sh/uv', [['0.12.19', 'Fixes']])),
  'https://downloads.claude.ai/claude-code-releases/latest': () => new Response('2.1.290\n'),
  'https://registry.npmjs.org/@openai%2Fcodex/latest': () => Response.json({ version: '0.156.1' }),
  'https://registry.npmjs.org/@agentclientprotocol%2Fclaude-agent-acp/latest': () =>
    Response.json({ version: '0.81.2' }),
  'https://registry.npmjs.org/@agentclientprotocol%2Fcodex-acp/latest': () =>
    Response.json({ version: '1.13.1' }),
  'https://registry.npmjs.org/bun/latest': () => Response.json({ version: '1.4.3' }),
  'https://registry.npmjs.org/wetty/latest': () => Response.json({ version: '3.2.2' }),
  'https://nodejs.org/dist/index.json': () =>
    Response.json([
      { version: 'v26.1.0', lts: false, security: false },
      { version: 'v24.22.0', lts: 'Krypton', security: true },
      { version: 'v24.21.0', lts: 'Krypton', security: false },
    ]),
  'https://github.com/coder/code-server/releases.atom': () =>
    new Response(atom('coder/code-server', [['v4.138.0', 'same']])),
  'https://github.com/kasmtech/KasmVNC/releases.atom': () =>
    new Response(atom('kasmtech/KasmVNC', [['v1.5.0', 'same']])),
  'https://github.com/agentclientprotocol/claude-agent-acp/releases.atom': () =>
    new Response(
      atom('agentclientprotocol/claude-agent-acp', [
        ['v0.81.2', 'Announce resumed subagents'],
        ['v0.81.1', 'Installed'],
      ]),
    ),
  'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md': () =>
    new Response('# Changelog\n\n## 2.1.290\n\n- Faster startup\n\n## 2.1.281\n\n- Old\n'),
  'https://github.com/oven-sh/bun/releases.atom': () =>
    new Response(atom('oven-sh/bun', [['bun-v1.4.3', 'Fixes']])),
  'https://github.com/nodejs/node/releases.atom': () =>
    new Response(atom('nodejs/node', [['v24.22.0', 'Security release']])),
};

const osvQueries: string[] = [];

function fakeVendors() {
  setUpdateFetch(async (url, init) => {
    if (url === 'https://api.osv.dev/v1/query') {
      const body = JSON.parse(String(init.body)) as { package: { name: string } };
      osvQueries.push(body.package.name);
      return Response.json(
        body.package.name === '@agentclientprotocol/claude-agent-acp'
          ? { vulns: [{ id: 'GHSA-test' }] }
          : {},
      );
    }
    if (url.startsWith('https://metadata.ftp-master.debian.org/')) {
      return new Response(
        'openssl (3.5.1-1+deb13u1) trixie-security; urgency=medium\n\n  * CVE-2026-1\n\n -- M <m@d.org>  Mon, 21 Sep 2026 10:00:00 +0000\n\nopenssl (3.5.1-1) trixie; urgency=medium\n\n  * old\n',
      );
    }
    const answer = VENDOR[url];
    return answer ? answer() : new Response('not found', { status: 404 });
  });
}

// The root helper: answers every request in the spool the way helena-update does.
function startFakeHelper(
  handle: (
    request: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
) {
  if (fakeHelper) throw new Error('Stop and drain the previous fake helper first');
  const helperSpool = spool;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = Promise.resolve();
  const errors: unknown[] = [];
  const poll = async () => {
    const dir = join(helperSpool, 'requests');
    for (const name of await readdir(dir)) {
      if (stopped) break;
      const path = join(dir, name);
      const request = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      await unlink(path);
      helperRequests.push(request);
      const answer = await handle(request);
      await writeFile(
        join(helperSpool, 'status', `${request.id as string}.json`),
        JSON.stringify({ id: request.id, action: request.action, ...answer }),
      );
    }
  };
  const tick = () => {
    timer = null;
    // One poll owns the spool until all its writes finish. Capture asynchronous failures
    // immediately and report them through stop(), never as an unhandled timer rejection.
    active = poll()
      .catch((error: unknown) => {
        errors.push(error);
        stopped = true;
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 20);
      });
  };
  timer = setTimeout(tick, 20);
  fakeHelper = {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
      if (errors.length) throw new AggregateError(errors, 'Fake update helper failed');
    },
  };
}

async function stopFakeHelper() {
  const helper = fakeHelper;
  try {
    await helper?.stop();
  } finally {
    if (fakeHelper === helper) fakeHelper = null;
  }
}

function helperAnswers(request: Record<string, unknown>): Record<string, unknown> {
  if (request.action === 'inventory' || request.action === 'apt-refresh')
    return { state: 'done', ok: true, result: INVENTORY };
  if (request.action === 'cli-runtime') {
    return {
      state: 'done',
      ok: true,
      log: `${request.runtime as string} upgraded`,
      result: { runtime: request.runtime, from: '0.81.1', to: request.version, smoke: 'passed' },
    };
  }
  if (request.action === 'apt') {
    return {
      state: 'done',
      ok: true,
      log: 'Setting up openssl',
      result: {
        upgraded: request.packages,
        rollback: 'apt-get install openssl=3.5.1-1',
        smoke: 'passed',
      },
    };
  }
  return { state: 'failed', ok: false, error: 'unknown action' };
}

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not reached');
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  backups = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'helena-update-backups-'));
  process.env.HELENA_UPDATE_BACKUP_DIR = backups;
  process.env.HELENA_RUNTIME_PREFIX = join(backups, 'no-runtimes');
  process.env.VOLITION_HOST_TOOLS_PREFIX = join(backups, 'host-tools');
});

afterAll(async () => {
  await rm(backups, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  spool = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'helena-update-spool-'));
  await mkdir(join(spool, 'requests'));
  await mkdir(join(spool, 'status'));
  process.env.HELENA_UPDATE_SPOOL = spool;
  helperRequests.length = 0;
  await rm(process.env.VOLITION_HOST_TOOLS_PREFIX!, { recursive: true, force: true });
  osvQueries.length = 0;
  fakeVendors();
});

afterEach(async () => {
  try {
    await stopFakeHelper();
  } finally {
    setUpdateFetch(null);
    await rm(spool, { recursive: true, force: true });
  }
});

describe('fake update helper lifecycle', () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('drains a suspended callback before teardown removes its status directory', async () => {
    const entered = deferred();
    const release = deferred();
    startFakeHelper(async () => {
      entered.resolve();
      await release.promise;
      return { state: 'done', ok: true };
    });
    await writeFile(
      join(spool, 'requests', 'drain.json'),
      JSON.stringify({ id: 'drain', action: 'inventory' }),
    );
    await entered.promise;
    let removed = false;
    let failure: unknown;
    let answer: unknown;
    const teardown = (async () => {
      await stopFakeHelper();
      answer = JSON.parse(await readFile(join(spool, 'status', 'drain.json'), 'utf8'));
      await rm(spool, { recursive: true });
      removed = true;
    })().catch((error: unknown) => {
      failure = error;
    });
    try {
      await Bun.sleep(50);
      expect(removed).toBe(false);
      expect(failure).toBeUndefined();
      expect(await readdir(join(spool, 'status'))).toEqual([]);
    } finally {
      release.resolve();
      await teardown;
    }
    expect(failure).toBeUndefined();
    expect(answer).toMatchObject({ id: 'drain', action: 'inventory', state: 'done', ok: true });
    expect(removed).toBe(true);
  });

  it('never starts another request while a callback is suspended', async () => {
    const entered = deferred();
    const release = deferred();
    startFakeHelper(async () => {
      entered.resolve();
      await release.promise;
      return { state: 'done', ok: true };
    });
    await writeFile(
      join(spool, 'requests', 'first.json'),
      JSON.stringify({ id: 'first', action: 'inventory' }),
    );
    await entered.promise;
    await writeFile(
      join(spool, 'requests', 'second.json'),
      JSON.stringify({ id: 'second', action: 'inventory' }),
    );
    try {
      // Several old interval ticks would overlap the held callback during this wait.
      await Bun.sleep(70);
      expect(helperRequests.map((request) => request.id)).toEqual(['first']);
    } finally {
      release.resolve();
      await stopFakeHelper();
    }
    expect(await readdir(join(spool, 'requests'))).toEqual(['second.json']);
  });

  it('reports callback and filesystem exceptions from the awaited stop', async () => {
    const entered = deferred();
    const failure = new Error('synthetic helper failure');
    startFakeHelper(async () => {
      entered.resolve();
      await Bun.sleep(10);
      throw failure;
    });
    await writeFile(
      join(spool, 'requests', 'failure.json'),
      JSON.stringify({ id: 'failure', action: 'inventory' }),
    );
    await entered.promise;
    const callbackError = await stopFakeHelper().catch((error: unknown) => error);
    expect(callbackError).toBeInstanceOf(AggregateError);
    expect((callbackError as AggregateError).errors).toEqual([failure]);

    await rm(join(spool, 'requests'), { recursive: true });
    startFakeHelper(helperAnswers);
    await Bun.sleep(50);
    const filesystemError = await stopFakeHelper().catch((error: unknown) => error);
    expect(filesystemError).toBeInstanceOf(AggregateError);
    expect((filesystemError as AggregateError).errors[0]).toMatchObject({ code: 'ENOENT' });
  });
});

async function owner() {
  const user = await signUpTestUser({ name: 'Owner' });
  return { user, api: authedApi(user.cookie) };
}

async function rows() {
  return db
    .select()
    .from(helenaUpdate)
    .orderBy(asc(helenaUpdate.source), asc(helenaUpdate.component));
}

describe('update center: checking', () => {
  it('repairs an operator rollback from the current link without a vendor fetch', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck({ only: 'host-tools' });
    await stopFakeHelper();
    const parent = join(process.env.VOLITION_HOST_TOOLS_PREFIX!, 'wetty');
    await mkdir(join(parent, '3.2.0'), { recursive: true });
    await writeFile(
      join(parent, '3.2.0', '.helena-installed.json'),
      JSON.stringify({ tool: 'wetty', version: '3.2.0' }),
    );
    await symlink('3.2.0', join(parent, 'current'));
    setUpdateFetch(async () => {
      throw new Error('vendor offline');
    });
    for (let read = 0; read < 2; read++) {
      const state = await api.god['update-center'].get();
      expect(state.status).toBe(200);
      expect(state.data!.items.find((item) => item.component === 'wetty')).toMatchObject({
        installed: '3.2.0',
        available: '3.2.2',
        updateAvailable: true,
      });
    }
  });

  it('is the Administrator’s alone', async () => {
    const { api } = await owner();
    const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
    expect((await member.god['update-center'].get()).status).toBe(403);
    expect((await member.god['update-center'].check.post()).status).toBe(403);
    const state = await api.god['update-center'].get();
    expect(state.status).toBe(200);
    expect(state.data!.sources.map((source) => source.id)).toEqual([
      'hermes',
      'cli-runtimes',
      'apt',
      'host-tools',
      'volition-catalog',
      'helena',
      // Local AI's own source (helena.local-ai): check only, empty without a model server.
      'local-ai',
    ]);
    expect(state.data!.sources[0]!.pluginId).toBe('helena.updates');
  });

  it('stores what every source found, security first', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    const outcome = await runUpdateCheck({ manual: true });
    expect(outcome.failed).toEqual([]);
    const byKey = new Map((await rows()).map((row) => [`${row.source}/${row.component}`, row]));

    expect(byKey.get('cli-runtimes/claude')).toMatchObject({
      installed: '2.1.281',
      available: '2.1.290',
      updateAvailable: true,
      applicable: true,
      security: false,
    });
    expect(byKey.get('cli-runtimes/claude-agent-acp')).toMatchObject({
      available: '0.81.2',
      updateAvailable: true,
      security: true,
    });
    expect(byKey.get('cli-runtimes/codex')).toMatchObject({ updateAvailable: false });
    // OSV is asked only about an npm runtime that has an update.
    expect(osvQueries).toEqual(['@agentclientprotocol/claude-agent-acp']);
    expect(byKey.get('apt/openssl')).toMatchObject({
      available: '3.5.1-1+deb13u1',
      security: true,
      groupKey: 'apt',
      applicable: true,
      detail: 'libssl3t64, openssl',
    });
    expect(byKey.get('apt/chromium')).toMatchObject({
      installed: '153.0.8010.52-1~deb13u1',
      updateAvailable: false,
    });
    expect(byKey.get('host-tools/node')).toMatchObject({
      installed: '24.21.0',
      available: '24.22.0',
      security: true,
      applicable: false,
    });
    expect(byKey.get('host-tools/bun')).toMatchObject({
      available: '1.4.3',
      updateAvailable: true,
    });
    expect(byKey.get('host-tools/kasmvnc')).toMatchObject({
      installed: '1.5.0',
      updateAvailable: false,
    });
    // No Hermes runner online: the source says so and keeps nothing it does not know.
    expect(byKey.get('hermes/hermes')).toMatchObject({ installed: null, updateAvailable: false });
    expect(byKey.get('hermes/hermes')).toMatchObject({
      error: null,
      hint: { i18n: 'updates.hints.hermesOffline' },
    });
    // Without UPDATE_FEED_URL Helena itself is not listed.
    expect(byKey.has('helena/helena')).toBe(false);

    const state = (await api.god['update-center'].get()).data!;
    expect(state.helper.installed).toBe(true);
    // Eden decodes ISO timestamps in responses into Date objects.
    expect(state.apt).toMatchObject({
      listsUpdatedAt: new Date('2026-09-24T08:00:00.000Z'),
      refreshedAt: new Date('2026-09-26T21:49:30.000Z'),
      refreshAttemptedAt: new Date('2026-09-26T21:49:29.000Z'),
      refreshError: null,
    });
    expect(helperRequests.filter((request) => request.action === 'apt-refresh')).toHaveLength(1);
    expect(state.counts).toEqual({ updates: 6, security: 3, applicable: 4 });
    expect(state.items.slice(0, 3).every((item) => item.security)).toBe(true);
    expect(state.items.at(-1)!.updateAvailable).toBe(false);
  });

  it('separates configured model revisions from software updates and refuses model apply', async () => {
    const { api } = await owner();
    const local = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/health')
          return Response.json({ status: 'ok', model: 'flash', version: { api: '0.14.2' } });
        if (path === '/v1/models')
          return Response.json({ data: [{ id: 'flash', context_length: 65536 }] });
        return new Response('', { status: 404 });
      },
    });
    try {
      expect(
        (
          await api.god['local-ai'].servers.post({
            slug: 'halogen',
            kind: 'halogen',
            baseUrl: `http://127.0.0.1:${local.port}/v1`,
            keySource: 'none',
          })
        ).status,
      ).toBe(200);
      await db.insert(helenaUpdate).values([
        { source: 'local-ai', component: 'watch:qwen4-moe', name: 'Qwen4 MoE', kind: 'tool' },
        {
          source: 'local-ai',
          component: 'watch:qwen-flash-next',
          name: 'Qwen Flash-Next',
          kind: 'tool',
        },
      ]);
      const requested: string[] = [];
      const watched = await configuredModelWatch(
        await db.select().from(helenaModelServer),
        [],
        null,
      );
      setUpdateFetch(async (url) => {
        requested.push(url);
        if (url.startsWith('https://ghcr.io/token')) return Response.json({});
        if (url.endsWith('/tags/list')) return Response.json({ tags: ['0.14.2', '0.14.3'] });
        if (url.startsWith('https://huggingface.co/api/models?'))
          return Response.json([{ id: 'Qwen/Qwen4-60B-A6B' }, { id: 'unsloth/Qwen4-235B-GGUF' }]);
        const source = watched.find(
          (entry) => url === `https://huggingface.co/api/models/${entry.repo}?blobs=true`,
        );
        if (source)
          return Response.json({
            id: source.repo,
            sha: 'b'.repeat(40),
            lastModified: '2026-09-30T08:00:00Z',
            cardData: { license: 'apache-2.0' },
            siblings: source.files.map((rfilename) => ({
              rfilename,
              lfs: {
                size: source.repo?.includes('Flash-Next-GGUF') ? 50_000_000_000 : 1_000_000_000,
              },
            })),
          });
        return VENDOR[url]?.() ?? new Response('', { status: 404 });
      });
      startFakeHelper(helperAnswers);
      await runUpdateCheck({ only: 'local-ai' });
      const state = (await api.god['update-center'].get()).data!;
      const items = state.items;
      expect(
        items.filter((item) => item.source === 'local-ai').map((item) => item.component),
      ).toEqual(['halogen']);
      expect(items.find((item) => item.component === 'halogen')).toMatchObject({
        installed: '0.14.2',
        available: '0.14.3',
        hint: { i18n: 'localAi.updates.halogenHint' },
      });
      expect(state.newModels).toHaveLength(3);
      expect(state.newModels.every((item) => !item.applicable && !item.autoAllowed)).toBe(true);
      expect(
        state.newModels.find(
          (item) => item.modelNotice?.repository === 'unsloth/Qwen3.8-Flash-Next-GGUF',
        ),
      ).toMatchObject({
        updateAvailable: true,
        modelNotice: {
          revision: 'b'.repeat(40),
          sizeBytes: 150_000_000_000,
          license: 'apache-2.0',
          date: new Date('2026-09-30T08:00:00.000Z'),
          fits: false,
        },
      });
      expect(items.some((item) => item.component.startsWith('watch:'))).toBe(false);
      const modelIds = new Set(state.newModels.map((item) => item.id));
      expect(
        (await digestTargets()).some((target) => target.rowIds.some((id) => modelIds.has(id))),
      ).toBe(false);
      const actionsBefore = helperRequests.length;
      expect(
        (await api.god['update-center'].items({ itemId: state.newModels[0]!.id }).apply.post({}))
          .status,
      ).toBe(409);
      expect(helperRequests).toHaveLength(actionsBefore);
      expect(
        requested
          .filter((url) => url.includes('huggingface.co'))
          .every((url) => url.startsWith('https://huggingface.co/api/models')),
      ).toBe(true);
      expect(
        (await rows()).some((row) =>
          ['watch:qwen4-moe', 'watch:qwen-flash-next'].includes(row.component),
        ),
      ).toBe(false);
    } finally {
      local.stop(true);
    }
  });

  it('reports native Whisper independently of model servers and refuses apply', async () => {
    const { api } = await owner();
    startFakeHelper((request) =>
      request.action === 'inventory'
        ? {
            state: 'done',
            ok: true,
            result: {
              ...INVENTORY,
              voice: {
                whisper: {
                  present: true,
                  state: 'active',
                  version: '1.8.4',
                  versionSource: 'running-executable-path',
                },
              },
            },
          }
        : helperAnswers(request),
    );
    await runUpdateCheck({ only: 'local-ai' });
    const whisper = (await rows()).find((row) => row.component === 'whisper-cpp')!;
    expect(whisper).toMatchObject({
      installed: '1.8.4',
      available: '1.9.4',
      updateAvailable: true,
      applicable: false,
      hint: { i18n: 'localAi.updates.whisperBuildRequired' },
    });
    expect(
      (await api.god['update-center'].items({ itemId: whisper.id }).apply.post({})).status,
    ).toBe(409);
    expect(helperRequests.every((request) => request.action === 'inventory')).toBe(true);
  });

  it('shows TTS and embedding build revisions without offering an unsafe apply', async () => {
    const { api } = await owner();
    startFakeHelper((request) =>
      request.action === 'inventory'
        ? {
            state: 'done',
            ok: true,
            result: {
              ...INVENTORY,
              voice: { qwentts: { present: true, version: '6a3e91283' } },
              embedding: { present: true, version: 'b11166' },
            },
          }
        : helperAnswers(request),
    );
    await runUpdateCheck({ only: 'local-ai' });
    for (const [component, installed, available] of [
      ['qwentts-cpp', '6a3e91283', 'abcdef123'],
      ['llama-cpp-embedding', 'b11166', 'b11200'],
    ]) {
      const row = (await rows()).find((entry) => entry.component === component)!;
      expect(row).toMatchObject({ installed, available, updateAvailable: true, applicable: false });
      expect((await api.god['update-center'].items({ itemId: row.id }).apply.post({})).status).toBe(
        409,
      );
    }
    expect(helperRequests.every((request) => request.action === 'inventory')).toBe(true);
  });

  for (const succeeded of [true, false])
    it(`records a prepared Whisper UI action and its ${succeeded ? 'live proof' : 'rollback failure'}`, async () => {
      const { api } = await owner();
      startFakeHelper((request) => {
        if (request.action === 'inventory')
          return {
            state: 'done',
            ok: true,
            result: {
              ...INVENTORY,
              voice: {
                whisper: {
                  present: true,
                  state: 'active',
                  version: '1.8.4',
                  versionSource: 'running-executable-path',
                  update: {
                    ready: true,
                    code: 'ready',
                    version: '1.9.4',
                    expiresAt: Date.now() / 1000 + 120,
                  },
                },
              },
            },
          };
        if (request.action === 'whisper-ui')
          return {
            state: succeeded ? 'done' : 'failed',
            ok: succeeded,
            error: succeeded ? null : 'Whisper rollback requires Root recovery',
            result: { phase: succeeded ? 'active' : 'restoring', speechVerified: succeeded },
          };
        return helperAnswers(request);
      });
      await runUpdateCheck({ only: 'local-ai' });
      const whisper = (await rows()).find((row) => row.component === 'whisper-cpp')!;
      expect(whisper.applicable).toBe(true);
      const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
      expect(
        (await member.god['update-center'].items({ itemId: whisper.id }).apply.post({})).status,
      ).toBe(403);
      const started = await api.god['update-center'].items({ itemId: whisper.id }).apply.post({});
      expect(started.status).toBe(201);
      const action = await waitFor(async () => {
        await followActions();
        const [current] = await db.select().from(helenaUpdateAction);
        return current?.state !== 'running' ? current : null;
      });
      expect(action.state).toBe(succeeded ? 'done' : 'failed');
      expect(action.result).toMatchObject({
        phase: succeeded ? 'active' : 'restoring',
        speechVerified: succeeded,
      });
      expect(helperRequests.find((request) => request.action === 'whisper-ui')).toMatchObject({
        version: '1.9.4',
      });
    }, 15_000);

  it('exposes failed metadata refresh and retains previous APT candidates', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck({ only: 'apt' });
    const previous = (await rows()).filter((row) => row.source === 'apt');
    await stopFakeHelper();
    startFakeHelper((request) =>
      request.action === 'apt-refresh'
        ? { state: 'failed', ok: false, error: 'security index unavailable' }
        : helperAnswers(request),
    );
    const outcome = await runUpdateCheck({ only: 'apt' });
    expect(outcome.failed).toEqual(['apt']);
    expect((await rows()).filter((row) => row.source === 'apt')).toEqual(previous);
    const state = (await api.god['update-center'].get()).data!;
    expect(new Date(state.apt!.refreshedAt!).toISOString()).toBe('2026-09-26T21:49:30.000Z');
    expect(state.apt?.refreshError).toBe('security index unavailable');
    expect(state.sources.find((source) => source.id === 'apt')?.error).toBe(
      'security index unavailable',
    );
  });

  it('keeps what a source knew when it fails, and names why', async () => {
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    // The helper stops answering: the Debian packages keep their rows and show the error.
    await stopFakeHelper();
    await rm(join(spool, 'status'), { recursive: true });
    await rm(join(spool, 'requests'), { recursive: true });
    const outcome = await runUpdateCheck();
    expect(outcome.failed).toEqual(['apt']);
    expect((await rows()).filter((row) => row.source === 'apt').length).toBeGreaterThan(0);
  });
});

async function hermesAgent(api: ReturnType<typeof authedApi>) {
  await api.projects.post({ key: 'PRIV', name: 'Privat' });
  const created = await createAgent(api, 'PRIV', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
  });
  const agent = created.data!.agent;
  // A Hermes agent whose runner is not polling right now: its runs wait in the queue for the
  // test to claim, and the Hermes update check does not wait for an answer.
  await db
    .update(aiAgent)
    .set({ runtimeState: { adapter: 'hermes', capabilities: ['digest-runs'] }, lastSeenAt: null })
    .where(eq(aiAgent.id, agent.id));
  const runner = apiKeyApi(created.data!.apiKey!);
  await runner['agent-chats'].catalog.post({
    models: [
      {
        id: 'helena-test-max',
        name: 'Max',
        reasoning: true,
        thinkingLevels: ['low', 'high'],
        thinkingDefault: null,
      },
      {
        id: 'helena-test-mini',
        name: 'Mini',
        reasoning: true,
        thinkingLevels: ['none', 'low'],
        thinkingDefault: null,
      },
      {
        id: 'helena-test-mini-900k',
        name: 'Mini 900k',
        reasoning: true,
        thinkingLevels: ['low'],
        thinkingDefault: null,
      },
      {
        id: 'helena-test-unpriced',
        name: 'Unpriced',
        reasoning: false,
        thinkingLevels: [],
        thinkingDefault: null,
      },
    ],
  });
  return { agent, runner };
}

describe('update center: summaries', () => {
  it('queues one text-only digest run per new version on the cheapest model, and stores the answer', async () => {
    const { user, api } = await owner();
    const { agent, runner } = await hermesAgent(api);
    await setManualPrice('helena-test-max', { inputPerMTok: 5, outputPerMTok: 20 }, user.userId);
    await setManualPrice(
      'helena-test-mini',
      { inputPerMTok: 0.1, outputPerMTok: 0.4 },
      user.userId,
    );
    await setManualPrice(
      'helena-test-mini-900k',
      { inputPerMTok: 0.01, outputPerMTok: 0.01 },
      user.userId,
    );
    expect(await pickDigestModel(agent.id, await getUpdateSettings())).toEqual({
      model: 'helena-test-mini',
      reasoning: 'low',
    });

    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    const queued = await queueDigests();
    // claude, claude-agent-acp, bun, node, and one for the Debian packages.
    expect(queued).toBe(5);
    const runs = await db.select().from(agentRun).where(eq(agentRun.trigger, 'digest'));
    expect(runs).toHaveLength(5);
    expect(runs.every((run) => run.model === 'helena-test-mini' && run.reasoning === 'low')).toBe(
      true,
    );
    expect(runs.every((run) => run.agentId === agent.id && run.issueId === null)).toBe(true);
    // A second check while they run queues nothing again.
    expect(await queueDigests()).toBe(0);

    // The runner claims one: the prompt as it is, the digest system prompt, the run's model.
    const claimed = (await runner['agent-runs'].claim.post()).data!.run!;
    expect(claimed.trigger).toBe('digest');
    expect(claimed.systemPrompt).toBe(DIGEST_SYSTEM_PROMPT);
    expect(claimed.model).toBe('helena-test-mini');
    expect(claimed.thinkingLevel).toBe('low');
    expect(claimed.prompt.startsWith('Komponente:')).toBe(true);
    expect(claimed.prompt).toContain('<release-notes>');

    const report = await runner['agent-runs']({ runId: claimed.id }).result.post({
      status: 'success',
      output:
        '{"zusammenfassung": "Neue Version.", "wichtig": ["Schneller"], "risiko": "niedrig", "breaking": false}',
      sessionId: 'session-digest',
      runtime: {
        requested: { model: 'helena-test-mini', reasoning: 'low' },
        defaults: null,
        used: { model: 'helena-test-mini', reasoning: 'low', provider: 'openai-codex' },
      },
    });
    expect(report.status).toBe(200);
    // A digest run is never followed by a reflection turn.
    expect((report.data as { reflection?: unknown } | null)?.reflection ?? null).toBeNull();
    const [done] = await db.select().from(agentRun).where(eq(agentRun.id, claimed.id));
    expect(done!.modelCheck).toMatchObject({
      configured: { model: 'helena-test-mini', reasoning: 'low', source: 'run' },
      mismatch: [],
    });

    expect(await collectDigests()).toBe(4);
    const summarized = (await rows()).filter((row) => row.summaryRunId === claimed.id);
    expect(summarized.length).toBeGreaterThan(0);
    expect(summarized[0]).toMatchObject({
      summary: 'Neue Version.',
      highlights: ['Schneller'],
      risk: 'low',
      breaking: false,
      summaryModel: 'helena-test-mini',
      summaryRunFor: null,
    });
    const view = (await api.god['update-center'].get()).data!.items.find(
      (item) => item.summaryRunId === claimed.id,
    )!;
    expect(view).toMatchObject({ summaryCurrent: true, summaryPending: false, risk: 'low' });
  });

  it('replaces summaries from a disabled local model using the configured cloud model', async () => {
    const { api } = await owner();
    const { agent, runner } = await hermesAgent(api);
    await setUpdateSettings({ model: 'helena-test-mini' });
    const created = await api.god['local-ai'].servers.post({
      slug: 'retired',
      baseUrl: 'http://127.0.0.1:1/v1',
      kind: 'lemonade',
      keySource: 'none',
      enabled: false,
    });
    expect(created.status).toBe(200);
    // Persist the cached probe of the retired server, as before it was disabled.
    await db
      .update(helenaModelServer)
      .set({
        models: [
          {
            id: 'Qwen3.6-35B-A3B-MTP-GGUF',
            name: 'Old Qwen',
            sizeBytes: null,
            backend: null,
            unit: 'gpu',
            capabilities: ['chat'],
            contextLength: 65536,
            loaded: false,
            downloaded: true,
          },
        ],
      })
      .where(eq(helenaModelServer.id, created.data!.id));
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    const all = await rows();
    const codex = all.find((row) => row.component === 'codex')!;
    const claude = all.find((row) => row.component === 'claude')!;
    for (const row of [codex, claude])
      await db
        .update(helenaUpdate)
        .set({
          summary: 'Earlier summary',
          summaryFor: row.available,
          risk: 'low',
          breaking: false,
          summaryModel: row.id === codex.id ? 'Qwen3.6-35B-A3B-MTP-GGUF' : 'helena-test-mini',
        })
        .where(eq(helenaUpdate.id, row.id));
    const view = (await api.god['update-center'].get()).data!.items;
    expect(view.find((row) => row.id === codex.id)).toMatchObject({
      summaryCurrent: false,
      summary: null,
    });
    expect(view.find((row) => row.id === claude.id)).toMatchObject({ summaryCurrent: true });
    const targets = await digestTargets();
    expect(targets.some((target) => target.rowIds.includes(codex.id))).toBe(true);
    expect(targets.some((target) => target.rowIds.includes(claude.id))).toBe(false);
    expect(await queueDigests()).toBe(5);
    expect(await queueDigests()).toBe(0);
    expect(await pickDigestModel(agent.id, await getUpdateSettings())).toMatchObject({
      model: 'helena-test-mini',
    });
    const claimed = (await runner['agent-runs'].claim.post()).data!.run!;
    expect(claimed.model).toBe('helena-test-mini');
  });

  it('queues and collects summaries automatically after a manual check', async () => {
    const { api } = await owner();
    const { runner } = await hermesAgent(api);
    await setUpdateSettings({ model: 'helena-test-mini' });
    startFakeHelper(helperAnswers);
    await runUpdatesJob({
      trigger: 'manual',
      scheduledFor: null,
      step: (_name, fn) => fn(),
      async sleep() {
        const view = (await api.god['update-center'].get()).data!.items;
        expect(view.some((item) => item.summaryPending)).toBe(true);
        for (;;) {
          const run = (await runner['agent-runs'].claim.post()).data!.run;
          if (!run) break;
          expect(run.model).toBe('helena-test-mini');
          expect(
            (
              await runner['agent-runs']({ runId: run.id }).result.post({
                status: 'success',
                output: '{"summary":"Current summary","risk":"low","breaking":false}',
              })
            ).status,
          ).toBe(200);
        }
      },
    });
    const view = (await api.god['update-center'].get()).data!.items.filter(
      (item) => item.updateAvailable,
    );
    expect(view.every((item) => item.summaryCurrent && !item.summaryPending)).toBe(true);
    expect(
      helperRequests.some((request) =>
        ['host-tool', 'runtime', 'apt-upgrade'].includes(String(request.action)),
      ),
    ).toBe(false);
  });

  it('reports summary preparation while release notes are still loading', async () => {
    const { api } = await owner();
    await hermesAgent(api);
    await setUpdateSettings({ model: 'helena-test-mini' });
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    setUpdateFetch(async () => {
      entered.resolve();
      await release.promise;
      return new Response('Notes');
    });
    const queue = queueDigests();
    try {
      await entered.promise;
      const view = (await api.god['update-center'].get()).data!.items;
      expect(view.some((item) => item.summaryPending && item.summaryRunId === null)).toBe(true);
    } finally {
      release.resolve();
      await queue;
    }
    expect(
      (await api.god['update-center'].get()).data!.items.filter((item) => item.summaryPending),
    ).toHaveLength(6);
  });

  it('moves to the next cheapest model when the account refuses one', async () => {
    const { user, api } = await owner();
    const { agent, runner } = await hermesAgent(api);
    await setManualPrice('helena-test-max', { inputPerMTok: 5, outputPerMTok: 20 }, user.userId);
    await setManualPrice(
      'helena-test-mini',
      { inputPerMTok: 0.1, outputPerMTok: 0.4 },
      user.userId,
    );
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    await queueDigests();
    for (;;) {
      const claimed = (await runner['agent-runs'].claim.post()).data!.run;
      if (!claimed) break;
      await runner['agent-runs']({ runId: claimed.id }).result.post({
        status: 'failed',
        error:
          "HTTP 400: The 'helena-test-mini' model is not supported when using Codex with a ChatGPT account.",
      });
    }
    expect(await collectDigests()).toBe(0);
    expect((await rows()).find((row) => row.component === 'claude')!.summaryError).toContain(
      'not supported',
    );
    expect(await pickDigestModel(agent.id, await getUpdateSettings())).toMatchObject({
      model: 'helena-test-max',
    });
    // The next check tries again, on that model.
    expect(await queueDigests()).toBe(5);
    const again = await db.select().from(agentRun).where(eq(agentRun.status, 'pending'));
    expect(again.every((run) => run.model === 'helena-test-max')).toBe(true);
  });

  it('never queues a summary on a runner that cannot run it text only', async () => {
    const { api } = await owner();
    const { agent } = await hermesAgent(api);
    await db
      .update(aiAgent)
      .set({ runtimeState: { adapter: 'hermes', capabilities: [] } })
      .where(eq(aiAgent.id, agent.id));
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    expect(await queueDigests()).toBe(0);
    expect(await db.select().from(agentRun)).toEqual([]);
  });

  it('names why nothing was summarized when no Hermes agent is there', async () => {
    await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    expect(await queueDigests()).toBe(0);
    expect((await rows()).find((row) => row.component === 'claude')!.summaryError).toBe(
      'No Hermes agent can write the summary',
    );
  });

  it('writes no summary when the owner turned summaries off', async () => {
    const { api } = await owner();
    await hermesAgent(api);
    await setUpdateSettings({ summarize: false });
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    expect(await queueDigests()).toBe(0);
  });
});

describe('update center: applying', () => {
  it('rejects an ok status without a passed model smoke', async () => {
    const { api } = await owner();
    startFakeHelper((request) =>
      request.action === 'cli-runtime'
        ? { state: 'done', ok: true, result: { runtime: request.runtime, smoke: 'failed' } }
        : helperAnswers(request),
    );
    await runUpdateCheck();
    const item = (await rows()).find((row) => row.component === 'claude-agent-acp')!;
    const started = await api.god['update-center'].items({ itemId: item.id }).apply.post({});
    expect(started.status).toBe(201);
    const actionId = started.data!.id;
    const finished = await waitFor(async () => {
      const response = await api.god['update-center'].actions({ actionId }).get();
      return response.data?.state === 'failed' ? response.data : null;
    });
    expect(finished.error).toContain('Rauchtest');
  });

  it('hands a CLI runtime update to the helper and follows it to its end', async () => {
    const { api } = await owner();
    let installed = '0.81.1';
    const statusEvents: string[] = [];
    const unsubscribe = events.subscribe('helena.updates.status', (event) => {
      statusEvents.push(String((event.data as { phase: string }).phase));
    });
    try {
      startFakeHelper((request) => {
        if (request.action === 'inventory' || request.action === 'apt-refresh')
          return {
            state: 'done',
            ok: true,
            result: {
              ...INVENTORY,
              runtimes: { ...INVENTORY.runtimes, 'claude-agent-acp': { current: installed } },
            },
          };
        if (request.action === 'cli-runtime') installed = String(request.version);
        return helperAnswers(request);
      });
      await runUpdateCheck();
      const item = (await rows()).find((row) => row.component === 'claude-agent-acp')!;
      const started = await api.god['update-center'].items({ itemId: item.id }).apply.post({});
      expect(started.status).toBe(201);
      expect(started.data).toMatchObject({ fromVersion: '0.81.1', toVersion: '0.81.2' });
      const request = await waitFor(async () =>
        helperRequests.find((entry) => entry.action === 'cli-runtime'),
      );
      expect(request).toMatchObject({ runtime: 'claude-agent-acp', version: '0.81.2' });
      const done = await waitFor(async () => {
        const action = (
          await api.god['update-center'].actions({ actionId: started.data!.id }).get()
        ).data!;
        return action.state === 'done' ? action : null;
      });
      expect(done.log).toContain('claude-agent-acp upgraded');
      expect(done.health).toMatchObject({ services: expect.any(Array) });
      expect(done.backupPath).toBeNull();
      await waitFor(async () =>
        (await rows()).find((row) => row.component === 'claude-agent-acp')?.installed === '0.81.2'
          ? true
          : null,
      );
      expect(statusEvents).toEqual(['finished', 'checked']);
    } finally {
      unsubscribe();
    }
  });

  it('applies only a current low-risk automatic update and does not retry a failed version', async () => {
    const { api } = await owner();
    startFakeHelper((request) =>
      request.action === 'cli-runtime'
        ? { state: 'failed', ok: false, error: 'update failed; previous version restored' }
        : helperAnswers(request),
    );
    await runUpdateCheck();
    const acp = (await rows()).find((row) => row.component === 'claude-agent-acp')!;
    const node = (await rows()).find((row) => row.component === 'node')!;
    const initial = (await api.god['update-center'].get()).data!;
    expect(initial.items.find((item) => item.id === acp.id)?.mode).toBe('manual');
    expect(initial.items.find((item) => item.id === node.id)?.mode).toBe('manual');
    expect(
      (
        await api.god['update-center'].settings.patch({
          modes: { 'cli-runtimes/claude-agent-acp': 'auto' },
        })
      ).status,
    ).toBe(400);
    await db
      .update(helenaUpdate)
      .set({
        risk: 'low',
        breaking: false,
        summary: 'Safe',
        summaryModel: 'helena-test-mini',
        summaryFor: acp.available,
      })
      .where(eq(helenaUpdate.id, acp.id));
    await db
      .update(helenaUpdate)
      .set({
        risk: 'high',
        breaking: false,
        summary: 'Risky',
        summaryModel: 'helena-test-mini',
        summaryFor: node.available,
      })
      .where(eq(helenaUpdate.id, node.id));
    expect(
      (await api.god['update-center'].get()).data!.items.find((item) => item.id === acp.id)?.mode,
    ).toBe('auto');
    expect(
      (
        await api.god['update-center'].settings.patch({
          modes: { 'cli-runtimes/claude-agent-acp': 'auto' },
        })
      ).status,
    ).toBe(200);
    await hermesAgent(api);
    expect(await queueDigests()).toBeGreaterThan(0);
    await expect(
      runAutoUpdates(async () => {
        throw new Error('deferred while busy');
      }),
    ).rejects.toThrow('deferred while busy');
    expect(helperRequests.filter((request) => request.action === 'cli-runtime')).toHaveLength(0);
    await db
      .update(agentRun)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(agentRun.status, 'pending'));
    await runAutoUpdates((ms) => Bun.sleep(Math.min(ms, 20)));
    const actions = await db.select().from(helenaUpdateAction);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      component: 'claude-agent-acp',
      automatic: true,
      state: 'failed',
    });
    await runAutoUpdates((ms) => Bun.sleep(Math.min(ms, 20)));
    expect(await db.select().from(helenaUpdateAction)).toHaveLength(1);
  });

  it('takes a database dump before the Debian security updates, and upgrades only those', async () => {
    const { user, api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    const openssl = (await rows()).find((row) => row.component === 'openssl')!;
    const actionId = await applyUpdate(user.userId, openssl.id, 'security');
    const request = await waitFor(async () =>
      helperRequests.find((entry) => entry.action === 'apt'),
    );
    expect(request).toMatchObject({ packages: ['libssl3t64', 'openssl'] });
    await waitFor(async () => {
      const response = await api.god['update-center'].actions({ actionId }).get();
      expect(response.status).toBe(200);
      expect(response.data?.id).toBe(actionId);
      return response.data?.state === 'done' ? response.data : null;
    });
    const [action] = await db
      .select()
      .from(helenaUpdateAction)
      .where(eq(helenaUpdateAction.id, actionId));
    expect(action).toMatchObject({ state: 'done', components: ['openssl'] });
    expect(action!.backupPath).toContain(backups);
    expect(action!.backupPath).toContain('pre-update');
    expect((await readdir(backups)).some((name) => name.endsWith('-pre-update.dump'))).toBe(true);
    const state = (await api.god['update-center'].get()).data!;
    expect(state.actions[0]).toMatchObject({ id: actionId, state: 'done' });
  });

  it('refuses what cannot be applied and a second update of the same source', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    await stopFakeHelper();
    // From now on the helper takes requests and never finishes them.
    startFakeHelper(() => ({ state: 'running' }));
    const all = await rows();
    const node = all.find((row) => row.component === 'node')!;
    expect((await api.god['update-center'].items({ itemId: node.id }).apply.post({})).status).toBe(
      409,
    );
    const claude = all.find((row) => row.component === 'claude')!;
    const acp = all.find((row) => row.component === 'claude-agent-acp')!;
    expect(
      (await api.god['update-center'].items({ itemId: claude.id }).apply.post({})).status,
    ).toBe(201);
    const second = await api.god['update-center'].items({ itemId: acp.id }).apply.post({});
    expect(second.status).toBe(409);
    const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
    expect(
      (await member.god['update-center'].items({ itemId: claude.id }).apply.post({})).status,
    ).toBe(403);
  });

  it('applies every advertised host tool through the helper and preserves a failed rollback result', async () => {
    const { api } = await owner();
    const tools = ['bun', 'node', 'code-server', 'wetty', 'kasmvnc'];
    startFakeHelper((request) => {
      if (request.action === 'inventory' || request.action === 'apt-refresh') {
        return { state: 'done', ok: true, result: { ...INVENTORY, hostToolApply: tools } };
      }
      if (request.action === 'host-tool') {
        return {
          state: 'failed',
          ok: false,
          error: 'update failed; previous version restored',
          log: 'Rollback succeeded: affected services healthy',
        };
      }
      return helperAnswers(request);
    });
    await runUpdateCheck();
    const all = await rows();
    for (const component of tools) {
      expect(
        all.find((row) => row.source === 'host-tools' && row.component === component)?.applicable,
      ).toBe(true);
    }
    const node = all.find((row) => row.component === 'node')!;
    const started = await api.god['update-center'].items({ itemId: node.id }).apply.post({});
    expect(started.status).toBe(201);
    const actionId = started.data!.id;
    expect(actionId).toBeGreaterThan(0);
    // POST also follows the action, so its terminal transition may already be consumed.
    const action = await waitFor(async () => {
      const response = await api.god['update-center'].actions({ actionId }).get();
      expect(response.status).toBe(200);
      expect(response.data?.id).toBe(actionId);
      return response.data?.state === 'failed' ? response.data : null;
    });
    expect(action).toMatchObject({
      state: 'failed',
      error: 'Update fehlgeschlagen: update failed; previous version restored',
    });
    expect(helperRequests.find((request) => request.action === 'host-tool')).toMatchObject({
      tool: 'node',
      version: node.available,
    });
  });

  it('shows uv and dispatches its exact version only when the helper supports it', async () => {
    const { api } = await owner();
    let enabled = false;
    startFakeHelper((request) => {
      if (request.action === 'inventory')
        return {
          state: 'done',
          ok: true,
          result: {
            ...INVENTORY,
            tools: { ...INVENTORY.tools, uv: '0.12.17' },
            hostToolApply: enabled ? ['uv'] : [],
          },
        };
      if (request.action === 'host-tool')
        return {
          state: 'done',
          ok: true,
          result: { tool: 'uv', from: '0.12.17', to: '0.12.19', smoke: 'passed' },
        };
      return helperAnswers(request);
    });
    await runUpdateCheck({ only: 'host-tools' });
    let uv = (await rows()).find((row) => row.component === 'uv')!;
    expect(uv).toMatchObject({
      installed: '0.12.17',
      available: '0.12.19',
      updateAvailable: true,
      applicable: false,
    });
    enabled = true;
    await runUpdateCheck({ only: 'host-tools' });
    uv = (await rows()).find((row) => row.component === 'uv')!;
    expect(uv).toMatchObject({ applicable: true, hint: null });
    const started = await api.god['update-center'].items({ itemId: uv.id }).apply.post({});
    expect(started.status).toBe(201);
    const actionId = started.data!.id;
    expect(actionId).toBeGreaterThan(0);
    await waitFor(async () => {
      const response = await api.god['update-center'].actions({ actionId }).get();
      expect(response.status).toBe(200);
      expect(response.data?.id).toBe(actionId);
      return response.data?.state === 'done' ? response.data : null;
    });
    expect(helperRequests.find((request) => request.action === 'host-tool')).toMatchObject({
      tool: 'uv',
      version: '0.12.19',
    });
  });

  it('marks an update the helper could not do as failed, with its reason', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    await stopFakeHelper();
    startFakeHelper((request) =>
      request.action === 'inventory'
        ? helperAnswers(request)
        : { state: 'failed', ok: false, error: 'the manifest is not signed', log: 'refused' },
    );
    const claude = (await rows()).find((row) => row.component === 'claude')!;
    const started = (await api.god['update-center'].items({ itemId: claude.id }).apply.post({}))
      .data!;
    const failed = await waitFor(async () => {
      const action = (await api.god['update-center'].actions({ actionId: started.id }).get()).data!;
      return action.state === 'failed' ? action : null;
    });
    expect(failed.error).toBe('Update fehlgeschlagen: the manifest is not signed');
  });
});

describe('update center: Hermes', () => {
  const ref = (version: string, commit: string) => ({ commit, describe: `v${version}`, version });

  async function answerNext(
    runner: ReturnType<typeof apiKeyApi>,
    answer: (request: Record<string, unknown>) => unknown,
  ) {
    for (let i = 0; i < 100; i++) {
      const claimed = (await runner['agent-runtime'].requests.claim.post()).data?.request;
      if (!claimed) continue;
      await runner['agent-runtime']
        .requests({ requestId: claimed.id })
        .answer.post({ ok: true, result: answer(claimed.request as Record<string, unknown>) });
      return claimed.request as Record<string, unknown>;
    }
    throw new Error('no request arrived');
  }

  it('does not offer a release that is an ancestor of the installed canary', async () => {
    const { api } = await owner();
    const { agent, runner } = await hermesAgent(api);
    await db
      .update(aiAgent)
      .set({
        runtimeState: { adapter: 'hermes', capabilities: ['update'] },
        lastSeenAt: new Date(),
      })
      .where(eq(aiAgent.id, agent.id));
    const checking = runUpdateCheck({ only: 'hermes', manual: true });
    await answerNext(runner, () => ({
      current: ref('0.0.0', 'd'.repeat(40)),
      latest: ref('0.21.5', 'e'.repeat(40)),
      latestIsAncestor: true,
      commits: [{ commit: 'e'.repeat(40), date: '2026-09-24', subject: 'stale release note' }],
      modelSmokeConfigured: true,
      localPatches: [],
    }));
    await checking;
    expect((await rows()).find((row) => row.source === 'hermes')).toMatchObject({
      updateAvailable: false,
      applicable: false,
    });
    expect((await api.god['hermes-update'].request.post()).status).toBe(409);
  });

  it('refreshes the Update Center from cached Hermes refs without a fetch', async () => {
    const { api } = await owner();
    const { agent, runner } = await hermesAgent(api);
    await db
      .update(aiAgent)
      .set({
        runtimeState: { adapter: 'hermes', capabilities: ['update'] },
        lastSeenAt: new Date(),
      })
      .where(eq(aiAgent.id, agent.id));
    const stale = runUpdateCheck({ only: 'hermes', manual: true });
    await answerNext(runner, () => ({
      current: { commit: 'd'.repeat(40), describe: 'dev-d8304d38', version: '0.0.0' },
      latest: { commit: 'e'.repeat(40), describe: 'dev-f05a3ca9', version: '0.0.0' },
      commits: [{ commit: 'e'.repeat(40), date: '2026-09-25', subject: 'dev' }],
      modelSmokeConfigured: true,
      localPatches: [],
    }));
    await stale;
    expect((await rows()).find((row) => row.source === 'hermes')!.updateAvailable).toBe(true);

    const refreshing = api.god['update-center'].hermes['refresh-local'].post();
    const request = await answerNext(runner, () => ({
      current: { commit: 'f'.repeat(40), describe: 'v2026.9.24-1-gf2718ab352', version: '0.0.0' },
      latest: { commit: 'a'.repeat(40), describe: 'v2026.9.24', version: '0.0.0' },
      commits: [],
      modelSmokeConfigured: true,
      localPatches: [{ commit: 'f'.repeat(40), date: '2026-09-26', subject: 'local patch' }],
    }));
    expect(request).toEqual({ op: 'runtime.update', action: 'check', offline: true });
    expect((await refreshing).status).toBe(200);
    expect((await rows()).find((row) => row.source === 'hermes')).toMatchObject({
      installed: '0.0.0 (ffffffff)',
      available: '0.0.0 (aaaaaaaa)',
      updateAvailable: false,
    });
    const saved = await getSetting<{ check: { current: { commit: string } }; offline?: boolean }>(
      'hermesUpdate',
    );
    expect(saved?.check.current.commit).toBe('f'.repeat(40));
    expect(saved?.offline).toBe(true);
    // A local reconciliation must not suppress the next scheduled upstream check.
    const scheduled = runUpdateCheck({ only: 'hermes' });
    const onlineRequest = await answerNext(runner, () => ({
      current: { commit: 'f'.repeat(40), describe: 'v2026.9.24-1-gf2718ab352', version: '0.0.0' },
      latest: { commit: 'a'.repeat(40), describe: 'v2026.9.24', version: '0.0.0' },
      commits: [],
      modelSmokeConfigured: true,
      localPatches: [],
    }));
    expect(onlineRequest).toEqual({ op: 'runtime.update', action: 'check' });
    await scheduled;
  });

  it.each([true, false])(
    'updates through the owner and runner with model proof=%s',
    async (proved) => {
      const { user, api } = await owner();
      const { agent, runner } = await hermesAgent(api);
      // The runner is online now, so the Hermes check goes to it.
      await db
        .update(aiAgent)
        .set({
          runtimeState: { adapter: 'hermes', capabilities: ['update'] },
          lastSeenAt: new Date(),
        })
        .where(eq(aiAgent.id, agent.id));
      startFakeHelper(helperAnswers);
      const checking = runUpdateCheck({ only: 'hermes', manual: true });
      await answerNext(runner, () => ({
        current: ref('0.21.4', 'a'.repeat(40)),
        latest: ref('0.22.0', 'b'.repeat(40)),
        commits: [{ commit: 'b'.repeat(40), date: '2026-09-28', subject: 'release 0.22.0' }],
        modelSmokeConfigured: true,
        localPatches: [{ commit: 'c'.repeat(40), date: '2026-09-24', subject: 'local patch' }],
      }));
      await checking;
      const hermes = (await rows()).find((row) => row.source === 'hermes')!;
      expect(hermes).toMatchObject({
        installed: '0.21.4 (aaaaaaaa)',
        available: '0.22.0 (bbbbbbbb)',
        updateAvailable: true,
        applicable: true,
        detail: '1 commits · 1 local',
      });

      const applying = applyUpdate(user.userId, hermes.id);
      const fresh = await answerNext(runner, () => ({
        current: ref('0.21.4', 'a'.repeat(40)),
        latest: ref('0.22.0', 'b'.repeat(40)),
        commits: [{ commit: 'b'.repeat(40), date: '2026-09-28', subject: 'release 0.22.0' }],
        modelSmokeConfigured: true,
        localPatches: [{ commit: 'c'.repeat(40), date: '2026-09-24', subject: 'local patch' }],
      }));
      expect(fresh).toEqual({ op: 'runtime.update', action: 'check' });
      const apply = await answerNext(runner, () => ({ id: 'helper-1', state: 'started' }));
      expect(apply).toEqual({ op: 'runtime.update', action: 'apply', target: 'b'.repeat(40) });
      const actionId = await applying;

      const following = followActions();
      await answerNext(runner, () => ({
        id: 'helper-1',
        state: 'done',
        ok: true,
        log: '$ git fetch',
        result: proved ? { modelSmoke: 'passed' } : {},
      }));
      if (!proved) {
        await answerNext(runner, () => ({
          current: ref('0.21.4', 'a'.repeat(40)),
          latest: ref('0.22.0', 'b'.repeat(40)),
          commits: [{ commit: 'b'.repeat(40), date: '2026-09-28', subject: 'release 0.22.0' }],
          modelSmokeConfigured: true,
          localPatches: [],
        }));
        await following;
        const [action] = await db
          .select()
          .from(helenaUpdateAction)
          .where(eq(helenaUpdateAction.id, actionId));
        expect(action).toMatchObject({ state: 'failed' });
        expect(action?.error).toContain('keinen bestandenen Modell-Rauchtest');
        return;
      }
      // Then Hermes is asked again what is installed now.
      await answerNext(runner, () => ({
        current: ref('0.22.0', 'b'.repeat(40)),
        latest: ref('0.22.0', 'b'.repeat(40)),
        commits: [],
        modelSmokeConfigured: true,
        localPatches: [],
      }));
      await following;
      await waitFor(async () => {
        const row = (await rows()).find((entry) => entry.source === 'hermes');
        return row?.updateAvailable === false ? row : null;
      });
      const [action] = await db
        .select()
        .from(helenaUpdateAction)
        .where(eq(helenaUpdateAction.id, actionId));
      expect(action).toMatchObject({
        state: 'done',
        log: '$ git fetch',
        fromVersion: '0.21.4 (aaaaaaaa)',
      });
    },
  );
});

describe('update center: stuck updates', () => {
  it('fails an update the helper never took or never finished', async () => {
    const { user } = await owner();
    const [neverStarted, neverFinished] = await db
      .insert(helenaUpdateAction)
      .values([
        { source: 'apt', component: 'openssl', name: 'openssl', requestedByUserId: user.userId },
        {
          source: 'cli-runtimes',
          component: 'claude',
          name: 'Claude Code',
          ref: '11111111-1111-4111-8111-111111111111',
          requestedByUserId: user.userId,
        },
      ])
      .returning({ id: helenaUpdateAction.id });
    expect(await followActions(Date.now() + 60_000)).toBe(0);
    expect(await followActions(Date.now() + 11 * 60_000)).toBe(1);
    expect(await followActions(Date.now() + 4 * 3_600_000)).toBe(1);
    const states = await db
      .select()
      .from(helenaUpdateAction)
      .where(inArray(helenaUpdateAction.id, [neverStarted!.id, neverFinished!.id]))
      .orderBy(asc(helenaUpdateAction.id));
    expect(states.map((row) => [row.state, row.error])).toEqual([
      ['failed', 'The update did not start'],
      ['failed', expect.stringContaining('did not finish in time')],
    ]);
  });
});

describe('update center: settings and the job', () => {
  it('checks the schedule and keeps the settings', async () => {
    const { api } = await owner();
    expect(
      (await api.god['update-center'].settings.patch({ cron: 'every day at nine' })).status,
    ).toBe(400);
    const saved = await api.god['update-center'].settings.patch({
      cron: '30 7 * * 1-5',
      model: 'helena-test-mini',
      reasoning: 'none',
    });
    expect(saved.data).toMatchObject({ cron: '30 7 * * 1-5', model: 'helena-test-mini' });
    const state = (await api.god['update-center'].get()).data!;
    expect(state.settings.reasoning).toBe('none');
    expect(state.job.nextRunAt).not.toBeNull();
    const off = await api.god['update-center'].settings.patch({ enabled: false });
    expect(off.data!.enabled).toBe(false);
    expect((await api.god['update-center'].get()).data!.job.nextRunAt).toBeNull();
  });

  it('runs the whole job from "Jetzt prüfen"', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    const answer = await api.god['update-center'].check.post();
    expect(answer.status).toBe(200);
    await waitFor(async () => {
      const [row] = await db
        .select()
        .from(helenaSystemJob)
        .where(eq(helenaSystemJob.id, UPDATES_JOB_ID));
      return row?.lastStatus === 'succeeded' ? row : null;
    });
    expect((await rows()).length).toBeGreaterThan(5);
    // A run that is going is not started a second time.
    await db
      .update(helenaSystemJob)
      .set({ lastStatus: 'running', lastStartedAt: new Date() })
      .where(eq(helenaSystemJob.id, UPDATES_JOB_ID));
    expect((await runSystemJobNow(UPDATES_JOB_ID)).started).toBe(false);
  });
});
