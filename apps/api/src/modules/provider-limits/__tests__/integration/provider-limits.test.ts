import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRuntimeRequest, agentUsage, aiAgent, db, helenaProviderLimit } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { routeTools } from '#mcp/generate';
import { spoolLimitSource } from '../../spool';
import {
  agentLimitState,
  recordLimitSnapshots,
  refreshProviderLimits,
  scheduleLimitProbes,
} from '../../service';

// Plan limits: what runners report is stored per account, read back with the state of
// every window, asked for on a schedule and on demand, and read from the owner's spool.

const HOUR = 3_600_000;

function snapshot(fields: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    provider: 'openai-codex',
    account: 'acct-chatgpt',
    source: 'hermes',
    login: 'hermes',
    plan: 'pro',
    windows: [
      {
        id: 'session',
        kind: 'session',
        label: null,
        usedPercent: 85,
        windowMinutes: 300,
        resetsAt: new Date(now + 2 * HOUR).toISOString(),
        severity: null,
        limited: null,
      },
      {
        id: 'weekly',
        kind: 'weekly',
        label: null,
        usedPercent: 40,
        windowMinutes: 10080,
        resetsAt: new Date(now + 72 * HOUR).toISOString(),
        severity: null,
        limited: null,
      },
    ],
    extra: null,
    resetCredits: 2,
    allowed: true,
    via: 'probe',
    observedAt: new Date(now - 60_000).toISOString(),
    unavailable: null,
    ...fields,
  };
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'VOL', name: 'Volume' });
  const created = await createAgent(asOwner, 'VOL', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
  });
  const agent = created.data!.agent;
  // A runner that reports the capability and was seen just now.
  await db
    .update(aiAgent)
    .set({
      runtimeState: { adapter: 'hermes', capabilities: ['limits'] },
      lastSeenAt: new Date(),
    })
    .where(eq(aiAgent.id, agent.id));
  const member = await signUpTestUser({ name: 'Member' });
  return {
    asOwner,
    agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
    asMember: authedApi(member.cookie),
  };
}

// The runner's side: claims the next request and answers `limits.read` with `snapshots`.
async function answerLimits(asRunner: Api, snapshots: unknown[]) {
  for (let i = 0; i < 100; i++) {
    const claimed = (await asRunner['agent-runtime'].requests.claim.post()).data!.request;
    if (claimed) {
      expect(claimed.request.op).toBe('limits.read');
      await asRunner['agent-runtime']
        .requests({ requestId: claimed.id })
        .answer.post({ ok: true, result: { snapshots } });
      return claimed;
    }
  }
  throw new Error('no request arrived');
}

describe('provider limits', () => {
  beforeEach(resetDb);
  it('excludes inactive Hermes snapshots even when historical agent links remain', async () => {
    const { asOwner, agent } = await setup();
    await recordLimitSnapshots(agent.id, [snapshot()]);
    expect((await asOwner['provider-limits'].get()).data!.accounts).toHaveLength(1);
    await db
      .update(aiAgent)
      .set({ runtimePolicy: { runtime: 'helena' } })
      .where(eq(aiAgent.id, agent.id));
    expect((await asOwner['provider-limits'].get()).data!.accounts).toHaveLength(0);
    await recordLimitSnapshots(null, [snapshot({ account: 'owner', source: 'codex' })]);
    expect(
      (await asOwner['provider-limits'].get()).data!.accounts.map((row) => row.account),
    ).toEqual(['owner']);
  });

  it("stores a runner's snapshot and reads it back with states and tokens", async () => {
    const { asOwner, asRunner, agent } = await setup();
    const sent = await asRunner['agent-runtime'].limits.post({
      snapshots: [{ ...snapshot(), email: 'owner@example.com', token: 'secret' }],
    });
    expect(sent.status).toBe(204);
    await db.insert(agentUsage).values({
      agentId: agent.id,
      projectId: null,
      kind: 'run',
      inputTokens: 1000,
      outputTokens: 500,
      occurredAt: new Date(Date.now() - HOUR),
    });

    const { data, status } = await asOwner['provider-limits'].get();
    expect(status).toBe(200);
    expect(data!.state).toBe('near');
    const [account] = data!.accounts;
    expect(account).toMatchObject({
      provider: 'openai-codex',
      plan: 'pro',
      state: 'near',
      stale: false,
      resetCredits: 2,
      agents: [{ id: agent.id, name: 'Coder' }],
    });
    expect(account!.windows.map((w) => [w.id, w.state, w.agentTokens])).toEqual([
      ['session', 'near', 1500],
      ['weekly', 'ok', 1500],
    ]);
    // Treaty hands date-time fields back as dates.
    expect(new Date(account!.nextResetAt!).getTime()).toBe(
      new Date(account!.windows[0]!.resetsAt!).getTime(),
    );
    expect(JSON.stringify(data)).not.toContain('example.com');
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(await agentLimitState(agent.id)).toBe('near');
  });

  it('keeps the probed windows when a run reports some of them', async () => {
    const { agent } = await setup();
    await recordLimitSnapshots(agent.id, [
      snapshot({
        windows: [
          ...snapshot().windows,
          {
            id: 'weekly:fable',
            kind: 'model',
            label: 'Fable',
            usedPercent: 3,
            windowMinutes: 10080,
            resetsAt: null,
          },
        ],
      }),
    ]);
    await recordLimitSnapshots(agent.id, [
      snapshot({
        via: 'passive',
        plan: null,
        resetCredits: null,
        observedAt: new Date().toISOString(),
        windows: [{ id: 'session', kind: 'session', usedPercent: 100, limited: true }],
        allowed: false,
      }),
    ]);
    const [row] = await db.select().from(helenaProviderLimit);
    expect(row!.windows.map((w) => [w.id, w.usedPercent])).toEqual([
      ['session', 100],
      ['weekly', 40],
      ['weekly:fable', 3],
    ]);
    expect(row!.plan).toBe('pro');
    expect(row!.resetCredits).toBe(2);
    expect(await agentLimitState(agent.id)).toBe('limited');

    // Older numbers than those stored change nothing.
    await recordLimitSnapshots(agent.id, [
      snapshot({ observedAt: new Date(Date.now() - 10 * HOUR).toISOString(), plan: 'plus' }),
    ]);
    const [kept] = await db.select().from(helenaProviderLimit);
    expect(kept!.plan).toBe('pro');
  });

  it('is read by the Administrator and by agents, not by other people', async () => {
    const { asMember, asRunner } = await setup();
    expect((await asMember['provider-limits'].get()).status).toBe(403);
    expect((await asRunner['provider-limits'].get()).status).toBe(200);
    expect((await asMember['provider-limits'].refresh.post()).status).toBe(403);
    expect((await asRunner['provider-limits'].settings.get()).status).toBe(403);
    const tool = routeTools(app).find((entry) => entry.name === 'get_provider_limits');
    expect(tool?.category).toBe('read');
  });

  it('asks the runners once per interval and stores their answers', async () => {
    const { asOwner, asRunner } = await setup();
    const queued = await scheduleLimitProbes(new Date());
    expect(queued).toBe(1);
    const claimed = await answerLimits(asRunner, [snapshot()]);
    expect(claimed.request).toMatchObject({ op: 'limits.read', force: false });
    expect((await asOwner['provider-limits'].get()).data!.accounts).toHaveLength(1);
    // Within the interval nothing more is asked.
    expect(await scheduleLimitProbes(new Date(Date.now() + 60_000))).toBe(0);
    expect(await scheduleLimitProbes(new Date(Date.now() + 11 * 60_000))).toBe(1);
    // Switched off, it asks nobody.
    await asOwner['provider-limits'].settings.patch({ enabled: false });
    expect(await scheduleLimitProbes(new Date(Date.now() + 60 * 60_000))).toBe(0);
  });

  it('refreshes on demand and waits for the runner', async () => {
    const { asRunner } = await setup();
    const refresh = refreshProviderLimits();
    await answerLimits(asRunner, [snapshot({ plan: 'plus' })]);
    const result = await refresh;
    expect(result.accounts[0]!.plan).toBe('plus');
    const requests = await db.select().from(agentRuntimeRequest);
    expect(requests.map((row) => (row.request as { force?: boolean }).force)).toEqual([true]);
  });

  it('validates the settings', async () => {
    const { asOwner } = await setup();
    expect((await asOwner['provider-limits'].settings.get()).data).toEqual({
      enabled: true,
      intervalMinutes: 10,
      nearPercent: 80,
    });
    expect((await asOwner['provider-limits'].settings.patch({ intervalMinutes: 2 })).status).toBe(
      400,
    );
    const changed = await asOwner['provider-limits'].settings.patch({
      intervalMinutes: 15,
      nearPercent: 90,
    });
    expect(changed.data).toEqual({ enabled: true, intervalMinutes: 15, nearPercent: 90 });
  });

  it('forgets an account', async () => {
    const { asOwner, agent } = await setup();
    await recordLimitSnapshots(agent.id, [snapshot()]);
    const [row] = await db.select().from(helenaProviderLimit);
    const removed = await asOwner['provider-limits']({ limitId: row!.id }).delete();
    expect(removed.status).toBe(204);
    expect((await asOwner['provider-limits'].get()).data!.accounts).toEqual([]);
  });
});

describe('spool', () => {
  let dir: string;
  beforeEach(async () => {
    await resetDb();
    dir = await mkdtemp(join(tmpdir(), 'helena-spool-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("reads the owner reporter's file once per change", async () => {
    const source = spoolLimitSource(() => dir);
    const log = { info() {}, warn() {}, error() {} };
    await writeFile(
      join(dir, 'owner.json'),
      JSON.stringify({
        version: 1,
        reporter: 'owner',
        reportedAt: new Date().toISOString(),
        snapshots: [snapshot({ provider: 'anthropic', account: 'acct-claude', login: 'owner' })],
      }),
    );
    await writeFile(join(dir, 'broken.json'), '{nope');
    const first = await source.poll!({ now: new Date(), log });
    expect(first).toHaveLength(1);
    expect(await source.poll!({ now: new Date(), log })).toEqual([]);
    expect(await recordLimitSnapshots(null, first)).toBe(1);
    const [row] = await db.select().from(helenaProviderLimit);
    expect(row).toMatchObject({ provider: 'anthropic', login: 'owner' });
    expect(await spoolLimitSource(() => undefined).poll!({ now: new Date(), log })).toEqual([]);
  });
});
