import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { normalizeHost } from '../../service';

// The network access of a project's isolated agents: the owner sets it, the egress proxy
// reads it with a token of its own and reports what it let through or refused.

const EGRESS_TOKEN = 'test-agent-egress-token-0123456789abcdef0123456789';

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-egress-'));
  const file = join(directory, 'token');
  writeFileSync(file, EGRESS_TOKEN, { mode: 0o600 });
  process.env.AGENT_EGRESS_TOKEN_FILE = file;
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const agent = await createAgent(asOwner, 'MKT', {
    name: 'Writer',
    username: 'writer',
    kind: 'external',
  });
  const other = await createAgent(asOwner, 'OPS', {
    name: 'Ops Bot',
    username: 'opsbot',
    kind: 'external',
  });
  return {
    asOwner,
    mkt,
    ops,
    agent: agent.data!.agent,
    agentKey: agent.data!.apiKey!,
    other: other.data!.agent,
  };
}

function internal(path: string, init: RequestInit & { token?: string } = {}) {
  const { token = EGRESS_TOKEN, ...rest } = init;
  return app.handle(
    new Request(`http://localhost${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  );
}

const event = (overrides: Record<string, unknown> = {}) => ({
  slug: 'mkt',
  agentId: null,
  runId: null,
  host: 'example.com',
  port: 443,
  decision: 'allowed',
  reason: null,
  connections: 2,
  bytesOut: 120,
  bytesIn: 4096,
  firstAt: '2026-09-23T10:00:00.000Z',
  lastAt: '2026-09-23T10:00:05.000Z',
  ...overrides,
});

describe('agent network settings', () => {
  beforeEach(resetDb);

  it('starts open, with nothing listed and every agent following the project', async () => {
    const { asOwner, agent } = await setup();
    const res = await asOwner.projects({ projectKey: 'MKT' }).settings['agent-network'].get();
    expect(res.data).toEqual({
      mode: 'open',
      allow: [],
      deny: [],
      mailPorts: false,
      agents: [{ id: agent.id, username: 'writer', name: 'Writer', mode: null }],
    });
  });

  it('keeps each of the three modes, for the project and for one agent', async () => {
    const { asOwner, agent } = await setup();
    const settings = () => asOwner.projects({ projectKey: 'MKT' }).settings['agent-network'];
    for (const mode of ['open', 'allowlist', 'blocked'] as const) {
      const res = await settings().put({ mode, agents: { [String(agent.id)]: mode } });
      expect(res.status).toBe(200);
      expect(res.data!.mode).toBe(mode);
      expect(res.data!.agents[0].mode).toBe(mode);
    }
    const cleared = await settings().put({ agents: { [String(agent.id)]: null } });
    expect(cleared.data!.agents[0].mode).toBeNull();
    expect(cleared.data!.mode).toBe('blocked');
  });

  it("refuses a mode for an agent that is not the project's", async () => {
    const { asOwner, other } = await setup();
    const res = await asOwner
      .projects({ projectKey: 'MKT' })
      .settings['agent-network'].put({ agents: { [String(other.id)]: 'blocked' } });
    expect(res.status).toBe(400);
  });

  it('stores the lists normalized', async () => {
    const { asOwner } = await setup();
    const res = await asOwner.projects({ projectKey: 'MKT' }).settings['agent-network'].put({
      mode: 'allowlist',
      allow: ['GitHub.com', '*.npmjs.org', 'bücher.de', 'api.github.com.', 'github.com'],
      deny: ['bank.example'],
      mailPorts: true,
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      mode: 'allowlist',
      allow: ['api.github.com', 'github.com', 'npmjs.org', 'xn--bcher-kva.de'],
      deny: ['bank.example'],
      mailPorts: true,
    });
  });

  it('refuses something that is no domain', async () => {
    const { asOwner } = await setup();
    for (const bad of ['http://example.com/x', 'localhost', 'a b.com', '-x.com', '1.2.3']) {
      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .settings['agent-network'].put({ deny: [bad] });
      expect(res.status).toBe(400);
    }
  });

  it('never lets an agent change it', async () => {
    const { agentKey } = await setup();
    const res = await apiKeyApi(agentKey)
      .projects({ projectKey: 'MKT' })
      .settings['agent-network'].put({ mode: 'open', deny: [] });
    expect(res.status).toBe(403);
  });
});

describe('egress proxy routes', () => {
  beforeEach(resetDb);

  it('refuses a request without the egress token', async () => {
    await setup();
    expect((await internal('/internal/agent-egress/policy', { token: '' })).status).toBe(401);
    expect((await internal('/internal/agent-egress/policy', { token: 'wrong' })).status).toBe(401);
  });

  it('reads the settings of every project by slug', async () => {
    const { asOwner, mkt, ops, other } = await setup();
    await asOwner.projects({ projectKey: 'OPS' }).settings['agent-network'].put({
      mode: 'allowlist',
      allow: ['github.com'],
      agents: { [String(other.id)]: 'blocked' },
    });
    const res = await internal('/internal/agent-egress/policy');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: Record<string, unknown> };
    expect(body.projects.mkt).toEqual({
      projectId: mkt.id,
      mode: 'open',
      allow: [],
      deny: [],
      mailPorts: false,
      agents: {},
    });
    expect(body.projects.ops).toMatchObject({
      projectId: ops.id,
      mode: 'allowlist',
      allow: ['github.com'],
      agents: { [String(other.id)]: 'blocked' },
    });
    expect(body.projects.home).toMatchObject({ projectId: null, mode: 'open' });
  });

  it("stores a report and keeps another project's agent out of it", async () => {
    const { asOwner, agent, other } = await setup();
    const res = await internal('/internal/agent-egress/events', {
      method: 'POST',
      body: JSON.stringify({
        events: [
          event({ agentId: agent.id }),
          event({
            agentId: other.id,
            host: '10.0.0.1',
            port: 80,
            decision: 'blocked',
            reason: 'private-address',
          }),
          event({ slug: 'nope' }),
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stored: number }).stored).toBe(2);

    const listed = await asOwner.projects({ projectKey: 'MKT' })['agent-network'].events.get();
    expect(listed.data!.items).toHaveLength(2);
    const [blocked, allowed] = listed.data!.items;
    expect(blocked).toMatchObject({
      host: '10.0.0.1',
      decision: 'blocked',
      reason: 'private-address',
      agent: null,
    });
    expect(allowed).toMatchObject({
      host: 'example.com',
      decision: 'allowed',
      connections: 2,
      bytesIn: 4096,
      agent: { id: agent.id, username: 'writer' },
    });

    const onlyBlocked = await asOwner
      .projects({ projectKey: 'MKT' })
      ['agent-network'].events.get({ query: { decision: 'blocked' } });
    expect(onlyBlocked.data!.items).toHaveLength(1);
  });

  it('refuses a report that is not one', async () => {
    await setup();
    for (const body of [
      { events: [event({ decision: 'maybe' })] },
      { events: [event({ port: 70000 })] },
      { events: [event({ reason: 'because' })] },
      { events: 'x' },
    ]) {
      const res = await internal('/internal/agent-egress/events', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('normalizeHost', () => {
  it('reads domains and IP literals', () => {
    expect(normalizeHost('Example.COM.')).toBe('example.com');
    expect(normalizeHost('*.example.com')).toBe('example.com');
    expect(normalizeHost('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeHost('93.184.216.34')).toBe('93.184.216.34');
    expect(normalizeHost('example')).toBeNull();
    expect(normalizeHost('ex ample.com')).toBeNull();
  });
});
