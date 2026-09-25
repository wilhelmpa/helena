import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRun, aiAgent, db, helenaSystemJob, helenaUpdate, helenaUpdateAction } from '@repo/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { setManualPrice } from '#modules/model-prices/service';
import { DIGEST_SYSTEM_PROMPT } from '../../digest-prompt';
import { setUpdateFetch } from '../../fetch';
import { runSystemJobNow } from '#modules/engine/system-jobs';
import { UPDATES_JOB_ID } from '../../job';
import {
  applyUpdate,
  collectDigests,
  followActions,
  queueDigests,
  runUpdateCheck,
} from '../../service';
import { pickDigestModel } from '../../digest';
import { getUpdateSettings, setUpdateSettings } from '../../settings';

// The update center end to end, with the vendors' endpoints and the root helper played by
// the test: what a check stores, the digest runs a Hermes runner claims and answers, and an
// update the owner starts, followed to its end.

let spool = '';
let backups = '';
let helperTimer: ReturnType<typeof setInterval> | null = null;
const helperRequests: Record<string, unknown>[] = [];

const INVENTORY = {
  apt: {
    os: 'Debian GNU/Linux 13 (trixie)',
    listsUpdatedAt: '2026-09-24T08:00:00+00:00',
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
function startFakeHelper(handle: (request: Record<string, unknown>) => Record<string, unknown>) {
  helperTimer = setInterval(async () => {
    const dir = join(spool, 'requests');
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name);
      const request = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      await unlink(path);
      helperRequests.push(request);
      const answer = handle(request);
      await writeFile(
        join(spool, 'status', `${request.id as string}.json`),
        JSON.stringify({ id: request.id, action: request.action, ...answer }),
      );
    }
  }, 20);
}

function helperAnswers(request: Record<string, unknown>): Record<string, unknown> {
  if (request.action === 'inventory') return { state: 'done', ok: true, result: INVENTORY };
  if (request.action === 'cli-runtime') {
    return {
      state: 'done',
      ok: true,
      log: `${request.runtime as string} upgraded`,
      result: { runtime: request.runtime, from: '0.81.1', to: request.version },
    };
  }
  if (request.action === 'apt') {
    return {
      state: 'done',
      ok: true,
      log: 'Setting up openssl',
      result: { upgraded: request.packages, rollback: 'apt-get install openssl=3.5.1-1' },
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
  osvQueries.length = 0;
  fakeVendors();
});

afterEach(async () => {
  if (helperTimer) clearInterval(helperTimer);
  helperTimer = null;
  setUpdateFetch(null);
  await rm(spool, { recursive: true, force: true });
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
    expect(state.counts).toEqual({ updates: 6, security: 3, applicable: 4 });
    expect(state.items.slice(0, 3).every((item) => item.security)).toBe(true);
    expect(state.items.at(-1)!.updateAvailable).toBe(false);
  });

  it('keeps what a source knew when it fails, and names why', async () => {
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    // The helper stops answering: the Debian packages keep their rows and show the error.
    if (helperTimer) clearInterval(helperTimer);
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
  it('hands a CLI runtime update to the helper and follows it to its end', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
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
      const action = (await api.god['update-center'].actions({ actionId: started.data!.id }).get())
        .data!;
      return action.state === 'done' ? action : null;
    });
    expect(done.log).toContain('claude-agent-acp upgraded');
    expect(done.health).toMatchObject({ services: expect.any(Array) });
    expect(done.backupPath).toBeNull();
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
    await waitFor(async () => (await followActions()) > 0 || null);
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
    if (helperTimer) clearInterval(helperTimer);
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

  it('marks an update the helper could not do as failed, with its reason', async () => {
    const { api } = await owner();
    startFakeHelper(helperAnswers);
    await runUpdateCheck();
    if (helperTimer) clearInterval(helperTimer);
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
    expect(failed.error).toBe('the manifest is not signed');
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

  it('checks through the runner, and updates as the owner who clicked', async () => {
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
    const apply = await answerNext(runner, () => ({ id: 'helper-1', state: 'started' }));
    expect(apply).toEqual({ op: 'runtime.update', action: 'apply', target: 'b'.repeat(40) });
    const actionId = await applying;

    const following = followActions();
    await answerNext(runner, () => ({
      id: 'helper-1',
      state: 'done',
      ok: true,
      log: '$ git fetch',
    }));
    await following;
    // Then Hermes is asked again what is installed now.
    await answerNext(runner, () => ({
      current: ref('0.22.0', 'b'.repeat(40)),
      latest: ref('0.22.0', 'b'.repeat(40)),
      commits: [],
      localPatches: [],
    }));
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
  });
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
