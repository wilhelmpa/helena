import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';

const policy = {
  runtime: 'helena' as const,
  reasoningEffort: null,
  toolAllow: [],
  toolDeny: [],
  mcpGrants: [],
  files: [],
  curator: true,
};
const skill = {
  path: 'deploy',
  name: 'deploy',
  markdown:
    '---\nname: deploy\ndescription: Use when deploying a release with a verified backup\n---\n## Steps\n1. Check the release candidate and its tests.\n2. Verify the backup before deployment.\n## Pitfalls\nDo not deploy without a verified backup.\n## Examples\nFor a weekly release, check tests and backup before deployment.',
  files: [{ path: 'scripts/check.sh', content: 'exit 0\n' }],
  otherFiles: 0,
  truncated: false,
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'NAT', name: 'Native' })).data!;
  const created = (
    await createAgent(api, 'NAT', {
      name: 'Native',
      username: 'native',
      kind: 'external',
      runtimePolicy: policy,
    })
  ).data!;
  return {
    api,
    teamId: project.teamId,
    projectId: project.id,
    agentId: created.agent.id,
    agent: apiKeyApi(created.apiKey!),
  };
}

let flag: string | undefined;
beforeEach(async () => {
  flag = process.env.HELENA_NATIVE_RUNTIME;
  process.env.HELENA_NATIVE_RUNTIME = 'on';
  await resetDb();
});
afterEach(() => {
  if (flag === undefined) delete process.env.HELENA_NATIVE_RUNTIME;
  else process.env.HELENA_NATIVE_RUNTIME = flag;
});

describe('native runtime parity', () => {
  it('creates, revises, pins and archives learned skills without losing scripts', async () => {
    const { api, teamId, agentId, agent } = await setup();
    const first = await agent['agent-runtime'].skills.put({ skill, baseRevision: null });
    expect(first.status).toBe(200);
    expect(first.data!.files).toEqual(skill.files);
    expect((await agent['agent-runtime'].skills.put({ skill, baseRevision: null })).status).toBe(
      409,
    );
    const changed = {
      ...skill,
      markdown: skill.markdown + '\nVerify the staging status afterward.',
    };
    const revised = await agent['agent-runtime'].skills.put({
      skill: changed,
      baseRevision: first.data!.revision,
    });
    expect(revised.status).toBe(200);
    const actions = api.teams({ teamId })['ai-agents']({ agentId })['runtime-actions'];
    expect((await actions.post({ kind: 'pin-skill', path: skill.path, pinned: true })).status).toBe(
      201,
    );
    expect((await agent['agent-runtime'].skills.get()).data![0]!.pinned).toBe(true);
    const snapshot = await agent['agent-runtime'].policy.get();
    expect(snapshot.data!.skills).toContainEqual(
      expect.objectContaining({
        slug: 'learned/deploy',
        files: skill.files,
        markdown: changed.markdown,
      }),
    );
    expect((await actions.post({ kind: 'discard-skill', path: skill.path })).status).toBe(201);
    expect((await agent['agent-runtime'].skills.get()).data).toEqual([]);
    const archived = await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      ['learned-skills'].content.get({ query: { path: skill.path } });
    expect(archived.data!.files).toEqual(skill.files);
  });

  it('keeps learned data when a stale native runner reports and rejects unsafe paths', async () => {
    const { agent } = await setup();
    await agent['agent-runtime'].skills.put({ skill, baseRevision: null });
    const report = await agent['agent-runtime'].status.post({
      adapter: 'helena',
      status: 'online',
      appliedRevision: 'old',
      capabilities: [],
      detail: null,
      learnedSkills: [],
    });
    expect(report.status).toBe(200);
    expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(1);
    expect(
      (
        await agent['agent-runtime'].skills.put({
          skill: { ...skill, path: '../escape' },
          baseRevision: null,
        })
      ).status,
    ).toBe(400);
  });

  it('curates duplicate content, preserves pinned skills and obeys the pause policy', async () => {
    const { agent, api, teamId, agentId } = await setup();
    const first = (await agent['agent-runtime'].skills.put({ skill, baseRevision: null })).data!;
    await db
      .update(aiAgent)
      .set({ volitionLearnedSkills: [first, { ...first, path: 'copy' }] })
      .where(eq(aiAgent.id, agentId));
    await agent['agent-runtime'].read.post({ op: 'curator.set', action: 'pin', skill: 'copy' });
    expect((await agent['agent-runtime'].read.post({ op: 'curator.run' })).status).toBe(200);
    expect((await agent['agent-runtime'].skills.get()).data!.map((s) => s.path)).toEqual(['copy']);
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({ runtimePolicy: { ...policy, curator: false, learning: false } });
    expect((await agent['agent-runtime'].read.post({ op: 'curator.status' })).data).toMatchObject({
      paused: true,
    });
    expect(
      (
        await agent['agent-runtime'].skills.put({
          skill: { ...skill, path: 'new' },
          baseRevision: null,
        })
      ).status,
    ).toBe(403);
  });

  it('reads native transcripts and search through the existing owner routes without a runner', async () => {
    const { api, agent, teamId, agentId } = await setup();
    const created = await agent['agent-runtime'].sessions.post({ kind: 'run' });
    const sessionId = created.data!.id;
    await agent['agent-runtime'].sessions({ sessionId }).items.post({
      items: [
        {
          seq: 1,
          step: 1,
          message: { role: 'user', content: 'Native history phrase' },
          text: 'Native history phrase',
        },
        {
          seq: 2,
          step: 1,
          message: {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { path: 'a' } },
            ],
          },
          text: '',
        },
      ],
    });
    const views = api.teams({ teamId })['ai-agents']({ agentId }).runtime.sessions;
    const listed = await views.get({ query: {} });
    expect(listed.status).toBe(200);
    expect(listed.data).toMatchObject({
      page: { total: 1, sessions: [{ id: sessionId, messageCount: 2, toolCallCount: 1 }] },
    });
    expect((await views.get({ query: { q: 'history phrase' } })).data).toMatchObject({
      hits: [{ sessionId }],
    });
    const transcript = await views({ sessionId }).get({ query: { offset: 1, limit: 1 } });
    expect(transcript.status).toBe(200);
    expect(transcript.data!.messages[0]!.parts).toEqual([
      { type: 'tool_call', id: 'c1', name: 'read_file', arguments: { path: 'a' } },
    ]);
  });

  it('previews runtime selection, rejects stale applies and preserves unrelated settings', async () => {
    const { api, teamId, agentId } = await setup();
    const selection = api.teams({ teamId })['ai-agents']['runtime-selection'];
    const input = { agentIds: [agentId], runtime: 'codex' as const };
    const preview = await selection.post(input);
    expect(preview.status).toBe(200);
    expect(preview.data!.applied).toBe(false);
    expect(
      (await api.teams({ teamId })['ai-agents']({ agentId }).get()).data!.runtimePolicy.runtime,
    ).toBe('helena');
    expect((await selection.post({ ...input, apply: true, revision: '0'.repeat(64) })).status).toBe(
      409,
    );
    expect(
      (await selection.post({ ...input, apply: true, revision: preview.data!.revision })).status,
    ).toBe(200);
    expect(
      (await api.teams({ teamId })['ai-agents']({ agentId }).get()).data!.runtimePolicy,
    ).toMatchObject({ runtime: 'codex', curator: true });
  });

  it('blocks runtime changes while a chat is pending', async () => {
    const { api, teamId, agentId } = await setup();
    await api
      .projects({ projectKey: 'NAT' })
      ['ai-agents']({ agentId })
      .chat.post({ prompt: 'Keep pending' });
    const selection = api.teams({ teamId })['ai-agents']['runtime-selection'];
    const input = { agentIds: [agentId], runtime: 'codex' as const };
    const preview = await selection.post(input);
    expect(preview.data!.busyAgentIds).toEqual([agentId]);
    expect(
      (await selection.post({ ...input, apply: true, revision: preview.data!.revision })).status,
    ).toBe(409);
  });
});

describe('profile import', () => {
  const bundle = {
    sourceKey: 'synthetic-profile',
    memory: [{ file: 'MEMORY.md' as const, content: 'Keep short reports.\n' }],
    skills: [skill],
    sessions: [
      {
        id: 'legacy-1',
        kind: 'reflection' as const,
        model: 'local/flash',
        startedAt: '2026-09-29T10:00:00Z',
        updatedAt: '2026-09-29T10:00:01Z',
        items: [
          {
            role: 'user' as const,
            content: 'Imported history',
            text: 'Imported history',
            timestamp: '2026-09-29T10:00:00Z',
          },
        ],
      },
    ],
  };

  it('previews without writing, applies atomically and makes concurrent retries unchanged', async () => {
    const { api, agent, agentId, teamId } = await setup();
    const endpoint = api.teams({ teamId })['ai-agents']({ agentId })['profile-import'];
    expect((await endpoint.post(bundle)).data).toMatchObject({
      applied: false,
      unchanged: false,
      memory: 1,
      skills: 1,
    });
    expect((await agent['agent-runtime'].skills.get()).data).toEqual([]);
    const results = await Promise.all([
      endpoint.post({ ...bundle, apply: true }),
      endpoint.post({ ...bundle, apply: true }),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.map((result) => result.data!.unchanged).sort()).toEqual([false, true]);
    const sessionId = results[0]!.data!.sessions[0]!.sessionId;
    const transcript = await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .runtime.sessions({ sessionId })
      .get({ query: {} });
    expect(transcript.data!.messages[0]!.parts).toEqual([
      { type: 'text', content: 'Imported history' },
    ]);
    const learned = (await agent['agent-runtime'].skills.get()).data![0]!;
    await agent['agent-runtime'].skills.put({
      skill: { ...skill, markdown: skill.markdown + '\nA newer native version.' },
      baseRevision: learned.revision,
    });
    expect((await endpoint.post({ ...bundle, apply: true })).data!.unchanged).toBe(true);
    expect((await agent['agent-runtime'].skills.get()).data![0]!.markdown).toBe(
      skill.markdown + '\nA newer native version.',
    );
    expect((await endpoint.post({ ...bundle, sourceKey: 'another', apply: true })).status).toBe(
      409,
    );
  });

  it('rolls back every write on a late link conflict and refuses unmapped private chats', async () => {
    const { api, agent, agentId, teamId } = await setup();
    const endpoint = api.teams({ teamId })['ai-agents']({ agentId })['profile-import'];
    const invalid = { ...bundle.sessions[0]!, id: 'private', kind: 'chat' as const };
    expect(
      (await endpoint.post({ ...bundle, sessions: [...bundle.sessions, invalid], apply: true }))
        .status,
    ).toBe(409);
    expect((await agent['agent-runtime'].skills.get()).data).toEqual([]);
    expect((await agent['agent-runtime'].memory.get()).data!.files).toEqual([]);
    const list = await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .runtime.sessions.get({ query: {} });
    expect(list.data).toMatchObject({ page: { total: 0 } });
  });

  it('includes AGENTS, project-wide and agent-specific organization instructions exactly once', async () => {
    const { api, agent, agentId, teamId, projectId } = await setup();
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({
        instructions: 'Unique agent instruction',
        runtimePolicy: {
          ...policy,
          files: [
            { kind: 'instructions', path: 'SOUL.md', content: 'Unique soul instruction' },
            {
              kind: 'instructions',
              path: 'instructions/AGENTS.md',
              content: 'Unique agents instruction',
            },
          ],
        },
      });
    await api
      .teams({ teamId })
      .organization.projects({ projectId })
      .put({ instructions: 'Unique organization instruction' });
    await api
      .teams({ teamId })
      .organization.agents({ agentId })
      .projects({ projectId })
      .patch({ instructions: 'Unique member instruction' });
    const native = (await agent['agent-runtime'].policy.get()).data!.runtimePolicy.files[0]!
      .content;
    for (const text of [
      'Unique soul instruction',
      'Unique agents instruction',
      'Unique agent instruction',
      'Unique organization instruction',
      'Unique member instruction',
    ])
      expect(native.split(text)).toHaveLength(2);
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({
        runtimePolicy: {
          ...policy,
          runtime: 'hermes',
          files: [
            { kind: 'instructions', path: 'SOUL.md', content: 'Unique soul instruction' },
            {
              kind: 'instructions',
              path: 'instructions/AGENTS.md',
              content: 'Unique agents instruction',
            },
          ],
        },
      });
    const hermes = (await agent['agent-runtime'].policy.get()).data!.runtimePolicy.files[0]!
      .content;
    for (const text of [
      'Unique soul instruction',
      'Unique agents instruction',
      'Unique agent instruction',
      'Unique organization instruction',
      'Unique member instruction',
    ])
      expect(hermes.split(text)).toHaveLength(2);
    const common = native.split('## Project development previews')[1];
    expect(common).toBeTruthy();
    expect(hermes).toContain(common!);
  });
});

test('native session paging and search do not count inaccessible private chats', async () => {
  const { api, agent, agentId, teamId } = await setup();
  const privateSession = (await agent['agent-runtime'].sessions.post({ kind: 'chat' })).data!.id;
  await agent['agent-runtime'].sessions({ sessionId: privateSession }).items.post({
    items: [
      {
        seq: 1,
        step: 1,
        message: { role: 'user', content: 'private-hidden' },
        text: 'private-hidden',
      },
    ],
  });
  const visible = (await agent['agent-runtime'].sessions.post({ kind: 'run' })).data!.id;
  const views = api.teams({ teamId })['ai-agents']({ agentId }).runtime.sessions;
  expect((await views.get({ query: { limit: 1 } })).data).toMatchObject({
    page: { total: 1, sessions: [{ id: visible }] },
  });
  expect((await views.get({ query: { q: 'private-hidden' } })).data).toEqual({ hits: [] });
  expect((await views({ sessionId: privateSession }).get({ query: {} })).status).toBe(404);
});

test('native skills survive switching to Hermes, its reports and a switch back', async () => {
  const { api, agent, teamId, agentId } = await setup();
  await agent['agent-runtime'].skills.put({ skill, baseRevision: null });
  const owner = api.teams({ teamId })['ai-agents']({ agentId });
  await owner.patch({ runtimePolicy: { ...policy, runtime: 'hermes' } });
  expect(
    (
      await agent['agent-runtime'].status.post({
        adapter: 'hermes',
        status: 'online',
        appliedRevision: 'legacy',
        capabilities: [],
        detail: null,
        learnedSkills: [],
      })
    ).status,
  ).toBe(200);
  await owner.patch({ runtimePolicy: policy });
  expect((await agent['agent-runtime'].skills.get()).data![0]!.files).toEqual(skill.files);
  expect((await agent['agent-runtime'].policy.get()).data!.skills).toContainEqual(
    expect.objectContaining({ slug: 'learned/deploy' }),
  );
});

test('native and imported private chats remain hidden from another team manager', async () => {
  const { api, agent, teamId, agentId } = await setup();
  const other = await signUpTestUser({ name: 'Other manager' });
  const invitation = await api
    .teams({ teamId })
    .invites.post({ email: other.email, role: 'manager' });
  const otherApi = authedApi(other.cookie);
  expect((await otherApi.invites({ token: invitation.data!.token }).accept.post()).status).toBe(
    200,
  );
  const chat = await api
    .teams({ teamId })
    ['ai-agents']({ agentId })
    .chat.post({ prompt: 'Private owner note' });
  const threadId = chat.data!.threadId;
  const native = (await agent['agent-runtime'].sessions.post({ kind: 'chat', threadId })).data!.id;
  const claimed = (await agent['agent-chats'].claim.post()).data!.message!;
  expect(
    (
      await agent['agent-chats']({ messageId: claimed.id }).result.post(
        { status: 'success' },
        { query: { claim: claimed.attempts } },
      )
    ).status,
  ).toBe(204);
  const imported = await api
    .teams({ teamId })
    ['ai-agents']({ agentId })
    ['profile-import'].post({
      sourceKey: 'private-owner',
      apply: true,
      memory: [],
      skills: [],
      sessions: [
        {
          id: 'legacy-private',
          kind: 'chat',
          threadId,
          model: null,
          startedAt: '2026-09-29T10:00:00Z',
          updatedAt: '2026-09-29T10:00:00Z',
          items: [
            {
              role: 'user',
              content: 'Private import',
              text: 'Private import',
              timestamp: '2026-09-29T10:00:00Z',
            },
          ],
        },
      ],
    });
  expect(imported.status).toBe(200);
  const importedId = imported.data!.sessions[0]!.sessionId;
  const foreign = otherApi.teams({ teamId })['ai-agents']({ agentId }).runtime.sessions;
  expect((await foreign.get({ query: {} })).data).toMatchObject({
    page: { total: 0, sessions: [] },
  });
  expect((await foreign({ sessionId: native }).get({ query: {} })).status).toBe(404);
  expect((await foreign({ sessionId: importedId }).get({ query: {} })).status).toBe(404);
  const own = await api
    .teams({ teamId })
    ['ai-agents']({ agentId })
    .runtime.sessions({ sessionId: importedId })
    .get({ query: {} });
  expect(own.status).toBe(200);
});

test('native runtime version is available without a runner request', async () => {
  const { api, teamId, agentId } = await setup();
  const result = await api.teams({ teamId })['ai-agents']({ agentId }).runtime.version.get();
  expect(result.status).toBe(200);
  expect(result.data).toMatchObject({ runtime: 'helena', version: '0.1.0' });
});

test('agent name lookup resolves PRIV coordinator instead of alphabetically first assistant', async () => {
  const { api, teamId } = await setup();
  await api.projects.post({ key: 'PRIV', name: 'Private' });
  const assistant = (
    await createAgent(api, 'PRIV', {
      name: 'Assistent PRIV',
      username: 'assistant-priv',
      kind: 'external',
    })
  ).data!.agent;
  const coordinator = (await api.teams({ teamId })['ai-agents'].get()).data!.find(
    (agent) => agent.username === 'priv-koordinator',
  )!;
  expect(coordinator).toBeDefined();
  const { organizationAgentAssignment } = await import('@repo/db');
  await db
    .insert(organizationAgentAssignment)
    .values({ teamId, agentId: assistant.id, role: 'specialist' })
    .onConflictDoUpdate({
      target: [organizationAgentAssignment.teamId, organizationAgentAssignment.agentId],
      set: { role: 'specialist' },
    });
  const result = await api
    .teams({ teamId })
    ['ai-agents'].get({ query: { query: 'PRIV Koordinator' } } as never);
  expect(result.status).toBe(200);
  expect(result.data!.map((agent) => agent.id)).toEqual([coordinator.id]);
});

test('historical run backfill is dry by default and repeatable', async () => {
  const { agentId, projectId } = await setup();
  const { agentRun, agentUsage } = await import('@repo/db');
  const { backfillRunUsage } = await import('../../../usage/backfill');
  const [run] = await db
    .insert(agentRun)
    .values({
      agentId,
      projectId,
      prompt: 'Historical fixture',
      status: 'failed',
      finishedAt: new Date(),
      inputTokens: 43320,
      outputTokens: 2858,
      model: 'helena-halogen/Flash',
    })
    .returning();
  await db.delete(agentUsage).where(eq(agentUsage.runId, run!.id));
  expect(await backfillRunUsage([run!.id])).toHaveLength(1);
  expect(await backfillRunUsage([run!.id])).toHaveLength(1);
  expect(await backfillRunUsage([run!.id], true)).toHaveLength(1);
  expect(await backfillRunUsage([run!.id], true)).toHaveLength(0);
});

test('expired run ledger retains the model recorded at claim time', async () => {
  const { api, teamId, agentId, projectId } = await setup();
  const { agentRun } = await import('@repo/db');
  const [run] = await db
    .insert(agentRun)
    .values({
      agentId,
      projectId,
      prompt: 'Expired fixture',
      inputTokens: 1000000,
      outputTokens: 100000,
      modelCheck: { configured: { model: 'claude-opus-5' } },
    })
    .returning();
  await db
    .update(agentRun)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(agentRun.id, run!.id));
  const usage = await api
    .teams({ teamId })
    ['agent-usage'].get({ query: { by: 'agent,model,kind' } });
  const row = usage.data!.rows.find((row) => row.agentId === agentId && row.kind === 'run')!;
  expect(row.model).toBe('claude-opus-5');
  expect(row.costEur).toBeCloseTo(6.45, 6);
  expect(row.unledgeredRuns).toBe(0);
});
