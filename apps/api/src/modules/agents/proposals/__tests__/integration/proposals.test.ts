import { describe, it, expect, beforeEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// Memory writes held for the owner: the runner keeps each memory file at its latest version,
// reports a change the agent made as a proposal, and writes it once the owner approves.
// Every version is kept as the memory's history.

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const memory = (content: string) => [
  {
    file: 'MEMORY.md' as const,
    content,
    truncated: false,
    sha256: sha256(content),
    chars: content.length,
  },
  { file: 'USER.md' as const, content: '', truncated: false, sha256: sha256(''), chars: 0 },
];

const inventory = (content: string) => ({
  toolsets: ['memory'],
  mcpServers: [],
  skills: [],
  memory: memory(content),
  cronJobs: 0,
});

const status = {
  adapter: 'hermes',
  status: 'online' as const,
  appliedRevision: null,
  capabilities: ['learning'],
  detail: null,
};

async function setup(memoryApproval = true) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Researcher',
    username: 'researcher',
    kind: 'external',
    // This suite exercises the explicit opt-in; new agents default to direct writes.
    runtimePolicy: {
      reasoningEffort: null,
      toolAllow: [],
      toolDeny: [],
      mcpGrants: [],
      files: [],
      memoryApproval,
    },
  });
  return {
    asOwner,
    teamId: project.data!.teamId,
    agentId: created.data!.agent.id,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

async function report(asRunner: Api, extra: Record<string, unknown>) {
  const res = await asRunner['agent-runtime'].status.post({ ...status, ...extra } as never);
  expect(res.status).toBe(200);
}

describe('memory proposals', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps memory writes without approval unless it is switched on', async () => {
    const { asRunner } = await setup(false);
    await report(asRunner, { inventory: inventory('Uses bun.') });
    expect((await asRunner['agent-runtime'].policy.get()).data!.memoryWrites.approval).toBe(false);
  });

  it('holds a memory write for the owner and writes it once approved', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup(false);
    // Approval is off by default (owner, 2026-09-26); switched on, it must hold every write.
    const current = (await asOwner.teams({ teamId })['ai-agents']({ agentId }).get()).data!;
    const switched = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({ runtimePolicy: { ...current.runtimePolicy, memoryApproval: true } } as never);
    expect(switched.status).toBe(200);

    // Before any version is known there is nothing to hold writes to.
    expect((await asRunner['agent-runtime'].policy.get()).data!.memoryWrites.approval).toBe(false);
    await report(asRunner, { inventory: inventory('Uses bun.') });
    const policy = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(policy.memoryWrites).toEqual({
      approval: true,
      baseline: [
        { file: 'MEMORY.md', sha256: sha256('Uses bun.'), content: 'Uses bun.' },
        { file: 'USER.md', sha256: sha256(''), content: '' },
      ],
    });

    const written = 'Uses bun.\n§\nOwner likes short answers.';
    await report(asRunner, {
      inventory: inventory('Uses bun.'),
      memoryProposals: [
        {
          file: 'MEMORY.md',
          content: written,
          sha256: sha256(written),
          baseSha256: sha256('Uses bun.'),
        },
      ],
    });
    const pending = (await asOwner['agent-proposals'].get({ query: {} })).data!;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'memory-write',
      status: 'pending',
      agentId,
      payload: { file: 'MEMORY.md', before: 'Uses bun.', after: written },
    });
    expect((await asOwner['agent-proposals'].count.get()).data!.count).toBe(1);
    // An agent never decides.
    expect(
      (
        await asRunner['agent-proposals']({ proposalId: pending[0]!.id }).decision.post({
          approved: true,
        })
      ).status,
    ).toBe(403);

    const decided = await asOwner['agent-proposals']({ proposalId: pending[0]!.id }).decision.post({
      approved: true,
    });
    expect(decided.data!.status).toBe('approved');
    const actions = (await asRunner['agent-runtime'].policy.get()).data!.actions;
    expect(actions).toEqual([
      {
        id: expect.any(Number),
        kind: 'write-memory',
        file: 'MEMORY.md',
        content: written,
        baseSha256: sha256('Uses bun.'),
      },
    ]);

    await report(asRunner, {
      inventory: inventory(written),
      actions: [{ id: actions[0]!.id, error: null }],
    });
    const applied = (await asOwner['agent-proposals'].get({ query: { status: 'decided' } })).data!;
    expect(applied[0]).toMatchObject({ status: 'applied', decidedByName: 'Owner' });

    const history = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .memory.revisions.get({ query: { file: 'MEMORY.md' } });
    expect(history.data!.map((revision) => [revision.source, revision.content])).toEqual([
      ['agent', written],
      ['observed', 'Uses bun.'],
    ]);
    // The approved version is what the runner keeps the file at now.
    expect(
      (await asRunner['agent-runtime'].policy.get()).data!.memoryWrites.baseline[0]!.content,
    ).toBe(written);

    // The file went back to its earlier version; the agent writing the approved content
    // again is a change again and waits for the owner again.
    await report(asRunner, { inventory: inventory('Uses bun.') });
    await report(asRunner, {
      inventory: inventory('Uses bun.'),
      memoryProposals: [
        {
          file: 'MEMORY.md',
          content: written,
          sha256: sha256(written),
          baseSha256: sha256('Uses bun.'),
        },
      ],
    });
    const again = (await asOwner['agent-proposals'].get({ query: {} })).data!;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({
      id: pending[0]!.id,
      status: 'pending',
      decidedByName: null,
      payload: { before: 'Uses bun.', after: written },
    });
  });

  it('drops a rejected write and replaces an older proposal with a newer one', async () => {
    const { asOwner, asRunner } = await setup();
    await report(asRunner, { inventory: inventory('Uses bun.') });
    const propose = (content: string) =>
      report(asRunner, {
        inventory: inventory('Uses bun.'),
        memoryProposals: [
          { file: 'MEMORY.md', content, sha256: sha256(content), baseSha256: sha256('Uses bun.') },
        ],
      });
    await propose('first');
    await propose('second');
    const pending = (await asOwner['agent-proposals'].get({ query: {} })).data!;
    expect(pending.map((proposal) => (proposal.payload as { after: string }).after)).toEqual([
      'second',
    ]);

    await asOwner['agent-proposals']({ proposalId: pending[0]!.id }).decision.post({
      approved: false,
      note: 'Not needed',
    });
    expect((await asRunner['agent-runtime'].policy.get()).data!.actions).toEqual([]);
    const decided = (await asOwner['agent-proposals'].get({ query: { status: 'decided' } })).data!;
    expect(decided.map((proposal) => proposal.status).sort()).toEqual(['rejected', 'rejected']);
  });
});

describe('Hermes settings from Helena', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("hands the runner the agent's disabled skills and its fallback models, else the instance's", async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    await asOwner.god['agent-runtime-settings'].put({
      fallbackModels: [{ provider: 'openrouter', model: 'google/gemini-3.6-flash' }],
      sessionRetentionDays: 365,
    });
    expect((await asRunner['agent-runtime'].policy.get()).data!.hermes).toEqual({
      skillsDisabled: [],
      fallbackModels: [{ provider: 'openrouter', model: 'google/gemini-3.6-flash' }],
      sessionRetentionDays: 365,
      compression: { thresholdTokens: 100_000 },
      bundledSkills: 'all',
    });

    const agent = (await asOwner.teams({ teamId })['ai-agents']({ agentId }).get()).data!;
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({
        runtimePolicy: {
          ...agent.runtimePolicy,
          skillsDisabled: ['airtable'],
          fallbackModels: [],
          compression: {
            thresholdTokens: 80_000,
            targetRatio: 0.3,
            idleCompactMinutes: 60,
            model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
          },
        },
      });
    expect((await asRunner['agent-runtime'].policy.get()).data!.hermes).toEqual({
      skillsDisabled: ['airtable'],
      fallbackModels: [],
      sessionRetentionDays: 365,
      compression: {
        thresholdTokens: 80_000,
        targetRatio: 0.3,
        idleCompactAfterSeconds: 3600,
        model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
      },
      bundledSkills: 'all',
    });

    // The instance's threshold and seeding for the agents without their own.
    await asOwner.god['agent-runtime-settings'].put({
      bundledSkills: 'essential',
      compressionThresholdTokens: 150_000,
    });
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({ runtimePolicy: { ...agent.runtimePolicy } });
    expect((await asRunner['agent-runtime'].policy.get()).data!.hermes).toMatchObject({
      compression: { thresholdTokens: 150_000 },
      bundledSkills: 'essential',
    });
  });
});

describe('Hermes update', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function answerNext(asRunner: Api, answer: (request: Record<string, unknown>) => unknown) {
    for (let i = 0; i < 50; i++) {
      const claimed = (await asRunner['agent-runtime'].requests.claim.post()).data!.request;
      if (!claimed) continue;
      await asRunner['agent-runtime']
        .requests({ requestId: claimed.id })
        .answer.post({ ok: true, result: answer(claimed.request as Record<string, unknown>) });
      return claimed.request as Record<string, unknown>;
    }
    throw new Error('no request arrived');
  }

  const ref = (version: string, commit: string) => ({ commit, describe: `v${version}`, version });

  it('checks, raises a proposal for the owner and starts the update once approved', async () => {
    const { asOwner, asRunner } = await setup();
    await report(asRunner, { inventory: inventory('') });

    const checking = asOwner.god['hermes-update'].check.post();
    const request = await answerNext(asRunner, () => ({
      current: ref('0.21.4', 'a'.repeat(40)),
      latest: ref('0.22.0', 'b'.repeat(40)),
      commits: [{ commit: 'b'.repeat(40), date: '2026-09-28', subject: 'release 0.22.0' }],
      localPatches: [{ commit: 'c'.repeat(40), date: '2026-09-24', subject: 'local patch' }],
    }));
    expect(request).toEqual({ op: 'runtime.update', action: 'check' });
    const checked = await checking;
    expect(checked.data!.check!.latest.version).toBe('0.22.0');

    const requested = await asOwner.god['hermes-update'].request.post();
    expect(requested.status).toBe(201);
    const pending = (await asOwner['agent-proposals'].get({ query: {} })).data!;
    expect(pending[0]).toMatchObject({ kind: 'hermes-update', title: 'Hermes 0.21.4 → 0.22.0' });

    const deciding = asOwner['agent-proposals']({ proposalId: pending[0]!.id }).decision.post({
      approved: true,
    });
    const apply = await answerNext(asRunner, () => ({ id: 'helper-1', state: 'started' }));
    expect(apply).toEqual({ op: 'runtime.update', action: 'apply', target: 'b'.repeat(40) });
    expect((await deciding).data!.status).toBe('approved');

    const following = asOwner.god['hermes-update'].get();
    await answerNext(asRunner, () => ({
      id: 'helper-1',
      state: 'done',
      ok: true,
      result: { to: ref('0.22.0', 'd'.repeat(40)) },
      log: '$ git fetch',
    }));
    const state = (await following).data!;
    expect(state.proposal).toMatchObject({ status: 'applied', log: '$ git fetch' });
  });
});
