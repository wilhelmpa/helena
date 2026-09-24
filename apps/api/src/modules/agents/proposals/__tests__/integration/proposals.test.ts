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

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Researcher',
    username: 'researcher',
    kind: 'external',
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

  it('holds a memory write for the owner and writes it once approved', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();

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
    });
    expect((await asRunner['agent-runtime'].policy.get()).data!.hermes).toEqual({
      skillsDisabled: [],
      fallbackModels: [{ provider: 'openrouter', model: 'google/gemini-3.6-flash' }],
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
        },
      });
    expect((await asRunner['agent-runtime'].policy.get()).data!.hermes).toEqual({
      skillsDisabled: ['airtable'],
      fallbackModels: [],
    });
  });
});
