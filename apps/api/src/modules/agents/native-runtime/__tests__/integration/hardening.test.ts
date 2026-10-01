import { systemJob } from '#modules/engine/system-jobs';
import { cancelMessage, readEvents } from '../../../chat/service';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import {
  agentChatMessage,
  aiAgent,
  setSetting,
  agentMemoryRevision,
  agentProposal,
  db,
  helenaAgentSession,
  helenaFact,
} from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addNote, memoryState, proposeMemory } from '../../memory';
import { consolidateAgentMemory, consolidateNotes } from '../../consolidation';
import { completeMemoryWrites, decideMemoryProposal } from '../../../memory/service';
import { reportRuntimeState } from '../../../runtime-policy/service';
import { compactSession } from '../../sessions';
import { getRunnerAgent } from '../../../runner/service';
import {
  agentMemorySource,
  agentSessionSource,
  factSource,
  reindexItems,
  searchKnowledgeIndex,
  useEmbedder,
  embedPending,
  semanticRetriever,
  saveSemanticSetting,
} from '@helena/knowledge';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'MEM', name: 'Memory' })).data!;
  const other = (await api.projects.post({ key: 'OTH', name: 'Other' })).data!;
  const created = (
    await createAgent(api, 'MEM', {
      name: 'Native',
      username: 'native',
      kind: 'external',
      runtimePolicy: {
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
        runtime: 'helena',
        memoryApproval: true,
      },
    })
  ).data!;
  const target = (
    await createAgent(api, 'MEM', {
      name: 'Coder',
      username: 'coder',
      kind: 'external',
      runtimePolicy: {
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
        runtime: 'codex',
      },
    })
  ).data!;
  return {
    owner,
    api,
    project,
    other,
    agent: created.agent,
    runner: apiKeyApi(created.apiKey!),
    target,
    targetRunner: apiKeyApi(target.apiKey!),
  };
}

async function approvedNote(agentId: number, userId: string, text: string, at = new Date()) {
  await addNote(agentId, text, at);
  const pending = (await db.select().from(agentProposal))
    .filter(
      (row) =>
        row.agentId === agentId && row.status === 'pending' && row.title.startsWith('notes/'),
    )
    .sort((a, b) => b.id - a.id)[0];
  expect(pending).toBeDefined();
  await decideMemoryProposal(pending!.id, true, userId, null);
}

async function killDuringUncommittedWrite(statement: string) {
  const code = `import { db } from '@repo/db'; import { sql } from 'drizzle-orm';
    await db.transaction(async (tx) => { await tx.execute(sql.raw(${JSON.stringify(statement)}));
      process.stdout.write('READY\\n'); await Bun.sleep(30000); });`;
  const child = Bun.spawn(['bun', '-e', code], {
    cwd: process.cwd(),
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  try {
    const chunk = await Promise.race([
      reader.read(),
      Bun.sleep(5000).then(() => {
        throw new Error('Child did not reach the write');
      }),
    ]);
    expect(new TextDecoder().decode(chunk.value)).toContain('READY');
  } finally {
    child.kill('SIGKILL');
    await child.exited;
    reader.releaseLock();
  }
}

describe('native runtime hardening', () => {
  let previousNativeRuntime: string | undefined;
  beforeEach(async () => {
    previousNativeRuntime = process.env.HELENA_NATIVE_RUNTIME;
    process.env.HELENA_NATIVE_RUNTIME = 'on';
    await resetDb();
  });
  afterEach(() => {
    useEmbedder(null);
    if (previousNativeRuntime === undefined) delete process.env.HELENA_NATIVE_RUNTIME;
    else process.env.HELENA_NATIVE_RUNTIME = previousNativeRuntime;
  });
  it('enforces team memory limits and a per-agent override at the exact stored boundary', async () => {
    const { agent, project, api } = await setup();
    const updated = await api.teams({ teamId: project.teamId })['agent-context-limits'].put({
      memory: 12,
      dailyNote: 14,
    });
    expect(updated.status).toBe(200);
    expect((await proposeMemory(agent.id, 'MEMORY.md', 'x'.repeat(11))).status).toBe('pending');
    await expect(proposeMemory(agent.id, 'MEMORY.md', 'x'.repeat(12))).rejects.toThrow(
      'limit is 12',
    );
    await expect(addNote(agent.id, 'this is too long')).rejects.toThrow('limit is 14');
    const [row] = await db
      .select({ policy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(eq(aiAgent.id, agent.id));
    await db
      .update(aiAgent)
      .set({ runtimePolicy: { ...(row!.policy as object), contextLimits: { memory: 20 } } })
      .where(eq(aiAgent.id, agent.id));
    expect((await proposeMemory(agent.id, 'MEMORY.md', 'y'.repeat(19))).status).toBe('pending');
    await expect(proposeMemory(agent.id, 'MEMORY.md', 'y'.repeat(20))).rejects.toThrow(
      'limit is 20',
    );
    const sizes = (
      await api
        .teams({ teamId: project.teamId })
        ['ai-agents']({ agentId: agent.id })
        ['context-sizes'].get()
    ).data!;
    expect(sizes.areas.find((area) => area.key === 'memory')?.limit).toBe(20);
    expect(sizes.areas.find((area) => area.key === 'dailyNote')?.limit).toBe(14);
    const detail = (
      await api.teams({ teamId: project.teamId })['ai-agents']({ agentId: agent.id }).get()
    ).data!;
    expect(detail.sizeLimits?.memory).toEqual({ used: 0, limit: 20, truncated: false });
    expect(detail.sizeLimits?.dailyNote?.limit).toBe(14);
    const list = (await api.teams({ teamId: project.teamId })['ai-agents'].get()).data!;
    expect(list.find((entry) => entry.id === agent.id)?.sizeLimits?.memory.limit).toBe(20);
  });
  it('refuses a temporary counter result as memory even when the model asks to save it', async () => {
    const { agent, runner } = await setup();
    const session = (await runner['agent-runtime'].sessions.post({ kind: 'run' })).data!;
    await runner['agent-runtime'].sessions({ sessionId: session.id }).items.post({
      items: [
        {
          seq: 1,
          step: 1,
          message: {
            role: 'user',
            content: 'Read the three current counters once and report their sum.',
          },
          text: 'Read the three current counters once and report their sum.',
        },
      ],
    });
    expect(
      (
        await runner['agent-runtime'].memory.notes.post({
          text: 'alpha=1 beta=2 gamma=3',
          sessionId: session.id,
        })
      ).status,
    ).toBe(400);
    expect(
      await db.select().from(agentMemoryRevision).where(eq(agentMemoryRevision.agentId, agent.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(agentProposal).where(eq(agentProposal.agentId, agent.id)),
    ).toHaveLength(0);
  });
  it('preserves committed session, skill and memory state when a writer process dies', async () => {
    const { agent, runner } = await setup();
    const session = (await runner['agent-runtime'].sessions.post({ kind: 'run' })).data!;
    await killDuringUncommittedWrite(
      `UPDATE helena_agent_session SET summary='partial', compacted_through=9 WHERE id='${session.id}'`,
    );
    const [stored] = await db
      .select()
      .from(helenaAgentSession)
      .where(eq(helenaAgentSession.id, session.id));
    expect(stored!.summary).toBeNull();
    expect(stored!.compactedThrough).toBe(0);
    await killDuringUncommittedWrite(
      `UPDATE ai_agent SET volition_learned_skills='[{"path":"partial"}]'::jsonb WHERE id=${agent.id}`,
    );
    const [afterSkill] = await db
      .select({ skills: aiAgent.volitionLearnedSkills })
      .from(aiAgent)
      .where(eq(aiAgent.id, agent.id));
    expect(afterSkill!.skills).toEqual([]);
    await killDuringUncommittedWrite(
      `INSERT INTO agent_memory_revision(agent_id,file,content,sha256,source) VALUES (${agent.id},'MEMORY.md','partial','partial','agent')`,
    );
    expect(
      await db.select().from(agentMemoryRevision).where(eq(agentMemoryRevision.agentId, agent.id)),
    ).toHaveLength(0);
  });
  it('serializes parallel compactions and permits an identical retry', async () => {
    const { agent, runner } = await setup();
    const session = (await runner['agent-runtime'].sessions.post({ kind: 'run' })).data!;
    const runnerAgent = (await getRunnerAgent(agent.userId))!;
    const results = await Promise.allSettled([
      compactSession(runnerAgent, session.id, 'First summary', 8),
      compactSession(runnerAgent, session.id, 'Second summary', 8),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [stored] = await db
      .select()
      .from(helenaAgentSession)
      .where(eq(helenaAgentSession.id, session.id));
    await compactSession(runnerAgent, session.id, stored!.summary!, 8);
    expect(stored!.compactedThrough).toBe(8);
  });
  it('does not roll back approved native memory from a stale runner inventory', async () => {
    const { agent, owner } = await setup();
    await proposeMemory(agent.id, 'MEMORY.md', 'Approved revision');
    const proposal = (await db.select().from(agentProposal)).find(
      (row) => row.status === 'pending',
    )!;
    await decideMemoryProposal(proposal!.id, true, owner.userId, null);
    for (const adapter of ['helena', 'hermes', 'claude']) {
      await reportRuntimeState(agent.id, {
        adapter,
        status: 'online',
        appliedRevision: null,
        capabilities: [],
        detail: null,
        inventory: {
          toolsets: [],
          mcpServers: [],
          skills: [],
          memory: [{ file: 'MEMORY.md', content: 'Stale inventory', truncated: false }],
        },
      });
      expect((await memoryState(agent.id)).files[0]!.content).toBe('Approved revision\n');
      expect(await db.select().from(agentMemoryRevision)).toHaveLength(1);
    }
  });
  it('keeps approved memory when a switched runtime first reports an empty profile', async () => {
    const { agent, owner } = await setup();
    await proposeMemory(agent.id, 'MEMORY.md', 'Approved handoff revision');
    const proposal = (await db.select().from(agentProposal)).find(
      (row) => row.status === 'pending',
    )!;
    await decideMemoryProposal(proposal.id, true, owner.userId, null);
    await db
      .update(aiAgent)
      .set({ runtimePolicy: { ...agent.runtimePolicy, runtime: 'hermes', memoryApproval: false } })
      .where(eq(aiAgent.id, agent.id));
    await reportRuntimeState(agent.id, {
      adapter: 'hermes',
      status: 'online',
      appliedRevision: null,
      capabilities: [],
      detail: null,
      inventory: {
        toolsets: [],
        mcpServers: [],
        skills: [],
        memory: [{ file: 'MEMORY.md', content: '', truncated: false }],
      },
    });
    expect((await memoryState(agent.id)).files[0]!.content).toBe('Approved handoff revision\n');
    expect(await db.select().from(agentMemoryRevision)).toHaveLength(1);
    await completeMemoryWrites(
      agent.id,
      [
        {
          id: 1,
          kind: 'write-memory',
          target: 'MEMORY.md',
          payload: { content: '' },
          userId: owner.userId,
        },
      ],
      [{ id: 1, error: null }],
    );
    expect((await memoryState(agent.id)).files[0]!.content).toBe('');
    expect(await db.select().from(agentMemoryRevision)).toHaveLength(2);
  });
  it('consolidates past notes once and applies the approved database revision', async () => {
    const { agent, owner } = await setup();
    await approvedNote(
      agent.id,
      owner.userId,
      'Use concise answers.',
      new Date('2026-09-26T12:00:00Z'),
    );
    await approvedNote(
      agent.id,
      owner.userId,
      'Use concise answers.',
      new Date('2026-09-27T12:00:00Z'),
    );
    await approvedNote(
      agent.id,
      owner.userId,
      'Today remains a note.',
      new Date('2026-09-28T12:00:00Z'),
    );
    const now = new Date('2026-09-28T01:00:00Z');
    const result = await consolidateAgentMemory(agent.id, now);
    expect(result?.status).toBe('pending');
    expect(result?.duplicates).toBe(1);
    expect((await memoryState(agent.id)).files).toHaveLength(0);
    await consolidateAgentMemory(agent.id, now);
    const proposals = (await db.select().from(agentProposal)).filter(
      (row) => row.status === 'pending',
    );
    expect(proposals).toHaveLength(1);
    await decideMemoryProposal(proposals[0]!.id, true, owner.userId, null);
    expect((await memoryState(agent.id)).files[0]!.content).toBe('- Use concise answers.\n');
    expect((await consolidateAgentMemory(agent.id, now))?.status).toBe('unchanged');
  });
  it('checks persisted facts within the agent project scope before consolidating', async () => {
    const { agent, owner, runner, project, other } = await setup();
    await runner['agent-facts'].post({
      action: 'add',
      content: 'Deploy-Tag ist Montag',
      entities: ['Deploy-Tag'],
    });
    const factProposal = (await db.select().from(agentProposal)).find((row) =>
      row.title.startsWith('Fact:'),
    )!;
    await decideMemoryProposal(factProposal.id, true, owner.userId, null);
    await db.insert(helenaFact).values({
      teamId: project.teamId,
      projectId: other.id,
      content: 'Foreign project note',
      category: 'memory',
    });
    const yesterday = new Date('2026-09-27T12:00:00Z');
    await approvedNote(agent.id, owner.userId, 'Deploy-Tag ist Montag', yesterday);
    await approvedNote(agent.id, owner.userId, 'Deploy-Tag ist Freitag', yesterday);
    await approvedNote(agent.id, owner.userId, 'Foreign project note', yesterday);
    const result = await consolidateAgentMemory(agent.id, new Date('2026-09-28T01:00:00Z'));
    expect(result).toMatchObject({
      duplicates: 1,
      conflicts: 1,
      content: '- Foreign project note',
      status: 'pending',
    });
  });

  it('transports updated central rules in the native snapshot', async () => {
    const { runner } = await setup();
    const before = (await runner['agent-runtime'].policy.get()).data!;
    await setSetting('helena.escalation', { enabled: true, defaultModel: 'gpt-6-sol' });
    const after = (await runner['agent-runtime'].policy.get()).data!;
    expect(after.revision).not.toBe(before.revision);
    expect(after.helena?.escalation?.central).toMatchObject({
      enabled: true,
      defaultModel: 'gpt-6.1-sol',
      failure: { localAttempts: 2 },
    });
  });

  it('filters compaction entries, battle notes and test markers without removing durable facts', () => {
    const result = consolidateNotes(
      '',
      [
        '- 09:00 [compaction:session:1] ## Goal old summary\ncontinuation of the summary\n- 10:00 Kundin Eva bevorzugt Rechnungen per PDF.\n- 11:00 Hinweis zum Battle-Test: temporäre Aufgabe\n- 12:00 Test-Notiz: Farbe Violett\n- 13:00 INJECT-OK-4711',
      ],
      [],
    );
    expect(result.content).toBe('- Kundin Eva bevorzugt Rechnungen per PDF.');
    expect(result.filtered).toBe(5);
  });

  it('lets only the team owner dream and records the filtered pending result', async () => {
    const { api, agent, owner, project, runner } = await setup();
    const route = api.teams({ teamId: project.teamId })['ai-agents']({ agentId: agent.id }).dream;
    expect((await route.get()).data).toEqual([]);
    expect(
      (
        await runner
          .teams({ teamId: project.teamId })
          ['ai-agents']({ agentId: agent.id })
          .dream.post()
      ).status,
    ).toBe(403);
    const date = new Date();
    await approvedNote(agent.id, owner.userId, 'Lieferantin Eva benötigt eine PDF-Rechnung.', date);
    await approvedNote(agent.id, owner.userId, '[compaction:session:1] compressed summary', date);
    await approvedNote(agent.id, owner.userId, 'Battle-Test: temporäre Farbe Violett', date);
    const stranger = await signUpTestUser({ name: 'Stranger' });
    const denied = await authedApi(stranger.cookie)
      .teams({ teamId: project.teamId })
      ['ai-agents']({ agentId: agent.id })
      .dream.post();
    expect(denied.status).toBe(404);
    const response = await route.post();
    expect(response.status).toBe(200);
    expect(response.data?.[0]).toMatchObject({
      trigger: 'manual',
      status: 'succeeded',
      result: { status: 'pending', filtered: 2 },
    });
    expect((await memoryState(agent.id)).files).toHaveLength(0);
    expect((await route.get()).data?.[0]).toMatchObject({ result: { filtered: 2 } });
  });

  it('registers the nightly engine job and records one consolidation step per native agent', async () => {
    const { agent, owner, api, project, other } = await setup();
    const coordinators = (
      await api.teams({ teamId: project.teamId })['ai-agents'].get()
    ).data!.filter((candidate) =>
      ['mem-koordinator', 'oth-koordinator'].includes(candidate.username),
    );
    expect(coordinators).toHaveLength(2);
    expect(coordinators.map((candidate) => candidate.projects[0]!.id)).toEqual([
      project.id,
      other.id,
    ]);
    await approvedNote(
      agent.id,
      owner.userId,
      'A durable nightly note.',
      new Date('2026-09-27T12:00:00Z'),
    );
    const job = systemJob('helena.memory-consolidation')!;
    expect(job.runWhenNew).toBe(true);
    expect(await job.schedule()).toEqual({
      enabled: true,
      cron: '0 3 * * *',
      timezone: 'Europe/Berlin',
    });
    const steps: string[] = [];
    await job.run({
      trigger: 'schedule',
      scheduledFor: new Date('2026-09-28T01:00:00Z'),
      step: async (name, fn) => {
        steps.push(name);
        return fn();
      },
      sleep: async () => {},
    });
    expect(steps).toEqual([
      'date',
      'agents',
      ...coordinators.map((candidate) => `memory:${candidate.id}`),
      `memory:${agent.id}`,
    ]);
    const proposal = (await db.select().from(agentProposal)).find(
      (row) => row.status === 'pending',
    )!;
    await decideMemoryProposal(proposal!.id, false, owner.userId, 'Not durable');
    await consolidateAgentMemory(agent.id, new Date('2026-09-28T01:00:00Z'));
    expect((await memoryState(agent.id)).files).toHaveLength(0);
    const rejected = (await db.select().from(agentProposal)).find((row) => row.id === proposal.id);
    expect(rejected!.status).toBe('rejected');
  });

  it('serializes concurrent daily notes without losing either line', async () => {
    const { agent, owner } = await setup();
    await Promise.all([addNote(agent.id, 'Alpha line'), addNote(agent.id, 'Beta line')]);
    const pending = (await db.select().from(agentProposal)).find(
      (row) => row.status === 'pending' && row.title.startsWith('notes/'),
    )!;
    await decideMemoryProposal(pending.id, true, owner.userId, null);
    const state = await memoryState(agent.id);
    expect(state.notes.at(-1)!.content).toContain('Alpha line');
    expect(state.notes.at(-1)!.content).toContain('Beta line');
  });

  it('holds notes and facts for approval with session provenance and deduplicates retries', async () => {
    const { agent, owner, runner } = await setup();
    const session = (await runner['agent-runtime'].sessions.post({ kind: 'run' })).data!;
    await runner['agent-runtime'].memory.notes.post({
      text: 'Monthly report uses verified totals.',
      sessionId: session.id,
    });
    expect((await memoryState(agent.id)).notes).toEqual([]);
    const [note] = (await db.select().from(agentProposal)).filter(
      (row) => row.status === 'pending',
    );
    await decideMemoryProposal(note!.id, true, owner.userId, null);
    const [revision] = await db.select().from(agentMemoryRevision);
    expect(revision!.sourceContext).toMatchObject({ sessionId: session.id });
    expect((await memoryState(agent.id)).notes.at(-1)!.content).toContain('verified totals');
    const input = {
      action: 'add' as const,
      content: 'Monthly report totals are verified before import',
    };
    const [first, retry] = await Promise.all([
      runner['agent-facts'].post(input),
      runner['agent-facts'].post(input),
    ]);
    expect(first.data!.status).toBe('pending');
    expect(retry.data!.status).toBe('pending');
    expect((await runner['agent-facts'].post({ action: 'list' })).data!.facts).toEqual([]);
    const pending = (await db.select().from(agentProposal)).filter(
      (row) => row.status === 'pending',
    );
    expect(pending).toHaveLength(1);
    await decideMemoryProposal(pending[0]!.id, true, owner.userId, null);
    expect((await runner['agent-facts'].post({ action: 'list' })).data!.facts).toHaveLength(1);
  });

  it('rejects foreign chat and run references when creating sessions', async () => {
    const { api, agent, runner, targetRunner } = await setup();
    const sent = await api
      .projects({ projectKey: 'MEM' })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Private work' });
    expect(
      (
        await targetRunner['agent-runtime'].sessions.post({
          kind: 'chat',
          threadId: sent.data!.threadId,
        })
      ).status,
    ).toBe(404);
    expect(
      (await runner['agent-runtime'].sessions.post({ kind: 'run', runId: 999999 })).status,
    ).toBe(404);
  });

  it('rejects approval against a stale baseline', async () => {
    const { agent, owner } = await setup();
    await proposeMemory(agent.id, 'MEMORY.md', '- proposed');
    const [proposal] = await db.select().from(agentProposal);
    await db.insert(agentMemoryRevision).values({
      agentId: agent.id,
      file: 'MEMORY.md',
      content: '- edited',
      sha256: 'newer',
      source: 'owner',
    });
    await expect(decideMemoryProposal(proposal!.id, true, owner.userId, null)).rejects.toThrow(
      'Memory changed',
    );
    expect((await memoryState(agent.id)).files[0]!.content).toBe('- edited');
  });
  it('filters duplicates and possible contradictions against facts', () => {
    const fact = {
      id: 1,
      content: 'Deploy-Tag ist Montag',
      entities: ['Deploy-Tag'],
      category: 'memory',
      trust: 0.9,
      updatedAt: new Date(),
      hrr: null,
    };
    const result = consolidateNotes(
      '',
      ['- 12:00 Deploy-Tag ist Montag\n- 12:01 Deploy-Tag ist Freitag'],
      [fact],
    );
    expect(result).toMatchObject({ duplicates: 1, conflicts: 1, content: '' });
  });
  it('hands a chat to Codex once with its project, context and requested model', async () => {
    const { api, owner, agent, runner, target, targetRunner, project } = await setup();
    expect(
      (
        await api
          .projects({ projectKey: 'MEM' })
          ['ai-agents']({ agentId: agent.id })
          .chat.post({ prompt: 'Implement this task.' })
      ).status,
    ).toBe(200);
    const claimed = (await runner['agent-chats'].claim.post()).data!.message!;
    const body = {
      status: 'success' as const,
      escalation: {
        target: 'runtime:codex/gpt-6-sol',
        reason: 'task-kind',
        detail: 'coding',
        handover: 'Continue implementation with recorded context.',
      },
    };
    const endpoint = runner['agent-chats']({ messageId: claimed.id });
    expect((await endpoint.result.post(body, { query: { claim: claimed.attempts } })).status).toBe(
      204,
    );
    expect((await endpoint.result.post(body, { query: { claim: claimed.attempts } })).status).toBe(
      204,
    );
    const messages = await db.select().from(agentChatMessage);
    expect(messages.filter((message) => message.agentId === target.agent.id)).toHaveLength(2);
    expect(messages.some((message) => message.content.includes('Handover to runtime:codex'))).toBe(
      true,
    );
    const followup = (await targetRunner['agent-chats'].claim.post()).data!.message!;
    expect(followup.projectId).toBe(project.id);
    expect(followup.model).toBe('gpt-6-sol');
    expect(followup.prompt).toContain('recorded context');
    expect(followup.sessionId).toBeNull();
    expect(await readEvents(followup.id, agent.id, owner.userId)).not.toBeNull();
    expect(await cancelMessage(followup.id, agent.id, owner.userId)).toBe(true);
    const [canceled] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, followup.id));
    expect(canceled!.status).toBe('canceled');
  });
  it('hands a Home chat only to a target with all-project scope', async () => {
    const { api, runner, agent, project, target, targetRunner } = await setup();
    const chat = api.teams({ teamId: project.teamId })['ai-agents']({ agentId: agent.id }).chat;
    const report = {
      status: 'success' as const,
      escalation: {
        target: 'runtime:codex',
        reason: 'failure',
        detail: null,
        handover: 'Continue Home work.',
      },
    };
    await chat.post({ prompt: 'Home task' });
    let claimed = (await runner['agent-chats'].claim.post()).data!.message!;
    await runner['agent-chats']({ messageId: claimed.id }).result.post(report);
    const [failed] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, claimed.id));
    expect(failed!.status).toBe('success');
    expect(failed!.lastError).toBeNull();
    await db.update(aiAgent).set({ projectScope: 'all' }).where(eq(aiAgent.id, target.agent.id));
    await chat.post({ prompt: 'Another Home task' });
    claimed = (await runner['agent-chats'].claim.post()).data!.message!;
    await runner['agent-chats']({ messageId: claimed.id }).result.post(report);
    const followup = (await targetRunner['agent-chats'].claim.post()).data!.message!;
    expect(followup.projectId).toBeNull();
    expect(followup.prompt).toContain('Continue Home work');
  });

  it('keeps an unavailable Codex escalation successful without creating a follow-up', async () => {
    const { api, agent, runner, target } = await setup();
    await db.update(aiAgent).set({ pausedAt: new Date() }).where(eq(aiAgent.id, target.agent.id));
    await api
      .projects({ projectKey: 'MEM' })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Continue.' });
    const claimed = (await runner['agent-chats'].claim.post()).data!.message!;
    const report = {
      status: 'success' as const,
      escalation: {
        target: 'runtime:codex/gpt-6.1-sol',
        reason: 'failure',
        detail: null,
        handover: 'Work',
      },
    };
    const endpoint = runner['agent-chats']({ messageId: claimed.id });
    expect(
      (await endpoint.result.post(report, { query: { claim: claimed.attempts } })).status,
    ).toBe(204);
    expect(
      (await endpoint.result.post(report, { query: { claim: claimed.attempts } })).status,
    ).toBe(204);
    const [answer] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, claimed.id));
    expect(answer!.status).toBe('success');
    expect(answer!.lastError).toBeNull();
    expect(answer!.content).toContain('Zeitgrenze/Eskalation nicht möglich');
    expect(answer!.content.match(/Zeitgrenze\/Eskalation nicht möglich/g)).toHaveLength(1);
  });
  it('pages sessions sharing a timestamp and latest memory revisions without omissions', async () => {
    const { agent, owner, project } = await setup();
    await db.insert(helenaAgentSession).values(
      [0, 1, 2].map(() => ({
        agentId: agent.id,
        teamId: project.teamId,
        projectId: project.id,
        kind: 'run',
        updatedAt: sql`'2026-09-20T10:00:00.123456Z'::timestamptz`,
      })),
    );
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const page = await agentSessionSource.list({ cursor, since: null, limit: 1 });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.cursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(3);
    await approvedNote(agent.id, owner.userId, 'First note', new Date('2026-09-20T10:00:00Z'));
    await approvedNote(agent.id, owner.userId, 'Second note', new Date('2026-09-21T10:00:00Z'));
    await approvedNote(
      agent.id,
      owner.userId,
      'First note updated',
      new Date('2026-09-20T12:00:00Z'),
    );
    const first = await agentMemorySource.list({ cursor: null, since: null, limit: 1 });
    const second = await agentMemorySource.list({ cursor: first.cursor, since: null, limit: 1 });
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(2);
  });
  it('indexes the three sources with project and private ACL in hybrid search', async () => {
    const { agent, owner, project, other } = await setup();
    const facts = await db
      .insert(helenaFact)
      .values(
        [project.id, other.id].map((projectId) => ({
          teamId: project.teamId,
          projectId,
          agentId: agent.id,
          content: 'Quartz searchable fact',
          category: 'memory',
        })),
      )
      .returning();
    await approvedNote(agent.id, owner.userId, 'Quartz private memory');
    const memory = (await agentMemorySource.list({ cursor: null, since: null, limit: 50 })).items;
    const sessions = await db
      .insert(helenaAgentSession)
      .values(
        [project.id, other.id].map((projectId) => ({
          teamId: project.teamId,
          projectId,
          agentId: agent.id,
          kind: 'run',
          summary: 'Quartz session',
        })),
      )
      .returning();
    await reindexItems(
      factSource,
      facts.map((fact) => String(fact.id)),
    );
    await reindexItems(
      agentMemorySource,
      memory.map((item) => item.id),
    );
    await reindexItems(
      agentSessionSource,
      sessions.map((session) => session.id),
    );
    const reach = {
      userId: agent.userId,
      projects: new Map([[project.id, new Set(['ai_agents'])]]),
      teams: new Map<number, Set<string>>(),
    };
    const embedder = {
      id: 'fixture-quartz',
      dims: 3,
      embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    };
    useEmbedder(embedder);
    await saveSemanticSetting({ enabled: true, model: embedder.id });
    expect(await embedPending(embedder)).toBeGreaterThan(0);
    const semantic = await semanticRetriever();
    const result = await searchKnowledgeIndex(
      reach,
      { q: 'Quartz', limit: 20, collapse: false },
      semantic ?? undefined,
    );
    expect(result.items.every((item) => item.matched.includes('meaning'))).toBe(true);
    expect(result.items.map((item) => item.source).sort()).toEqual([
      'agent-memory',
      'agent-session',
      'fact',
    ]);
    expect(result.items.every((item) => item.projectId !== other.id)).toBe(true);
    const stranger = await searchKnowledgeIndex(
      { userId: 'stranger', projects: new Map(), teams: new Map() },
      { q: 'Quartz', limit: 20 },
      semantic ?? undefined,
    );
    expect(stranger.items).toHaveLength(0);
    expect(await factSource.get(String(facts[0]!.id))).not.toBeNull();
    await db
      .update(helenaFact)
      .set({ deletedAt: new Date() })
      .where(eq(helenaFact.id, facts[0]!.id));
    expect(await factSource.get(String(facts[0]!.id))).toBeNull();
  });
});
