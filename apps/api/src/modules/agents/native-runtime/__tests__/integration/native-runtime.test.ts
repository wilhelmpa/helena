import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// Helena's own agent loop (docs/helena-decisions/zentrale-laufzeit.md): its sessions and
// memory, reached with the agent's key, and the fact store every runtime reaches through
// Helena's MCP server.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
  const researcher = await createAgent(asOwner, 'MKT', {
    name: 'Researcher',
    username: 'researcher',
    kind: 'external',
  });
  const operator = await createAgent(asOwner, 'OPS', {
    name: 'Operator',
    username: 'operator',
    kind: 'external',
  });
  return {
    asOwner,
    teamId: mkt.data!.teamId,
    agentId: researcher.data!.agent.id,
    asAgent: apiKeyApi(researcher.data!.apiKey!),
    asOther: apiKeyApi(operator.data!.apiKey!),
  };
}

describe("Helena's own runtime", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('sessions', () => {
    it('keeps a session the agent resumes, each message once', async () => {
      const { asAgent, asOther } = await setup();
      const created = await asAgent['agent-runtime'].sessions.post({
        kind: 'chat',
        model: 'helena-halogen/flash',
        threadId: 't-1',
      });
      expect(created.status).toBe(200);
      const sessionId = created.data!.id;
      const items = [
        {
          seq: 1,
          step: 1,
          message: { role: 'user', content: 'Merk dir 42.' },
          text: 'Merk dir 42.',
        },
        {
          seq: 2,
          step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Gemerkt.' }] },
          text: 'Gemerkt.',
        },
      ];
      const session = asAgent['agent-runtime'].sessions({ sessionId });
      expect((await session.items.post({ items })).status).toBe(200);
      // A retry of the same step changes nothing.
      expect((await session.items.post({ items: [items[1]!] })).status).toBe(200);
      await session.compaction.post({ summary: 'Die Zahl ist 42.', compactedThrough: 1 });
      const loaded = await session.get();
      expect(loaded.status).toBe(200);
      expect(loaded.data!.items.map((item) => item.seq)).toEqual([1, 2]);
      expect(loaded.data!.summary).toBe('Die Zahl ist 42.');
      expect(loaded.data!.compactedThrough).toBe(1);
      // Another agent's key does not reach it.
      const foreign = await asOther['agent-runtime'].sessions({ sessionId }).get();
      expect(foreign.status).toBe(404);
    });

    it('refuses an item that is not a model message', async () => {
      const { asAgent } = await setup();
      const created = await asAgent['agent-runtime'].sessions.post({ kind: 'run' });
      const answer = await asAgent['agent-runtime']
        .sessions({ sessionId: created.data!.id })
        .items.post({ items: [{ seq: 1, step: 1, message: { role: 'root' }, text: '' }] });
      expect(answer.status).toBe(400);
    });
  });

  describe('memory', () => {
    it('adds lines to the daily note and writes MEMORY.md without approval', async () => {
      const { asAgent, asOwner, teamId, agentId } = await setup();
      const memory = asAgent['agent-runtime'].memory;
      expect((await memory.notes.post({ text: 'Deploys laufen über deploy.sh.' })).status).toBe(
        200,
      );
      expect((await memory.notes.post({ text: 'Der Owner mag kurze Antworten.' })).status).toBe(
        200,
      );
      const written = await memory.proposals.post({ file: 'MEMORY.md', content: '- Nutzt bun.' });
      expect(written.data).toEqual({ status: 'applied' });
      const state = await memory.get();
      expect(state.data!.files.find((file) => file.file === 'MEMORY.md')!.content).toBe(
        '- Nutzt bun.\n',
      );
      const today = state.data!.notes.at(-1)!;
      expect(today.content).toContain('deploy.sh');
      expect(today.content).toContain('kurze Antworten');
      // The memory editor lists the notes.
      const notes = await asOwner.teams({ teamId })['ai-agents']({ agentId }).memory.notes.get();
      expect(notes.data![0]!.content).toContain('deploy.sh');
    });

    it('refuses a note that looks like a secret', async () => {
      const { asAgent } = await setup();
      const answer = await asAgent['agent-runtime'].memory.notes.post({
        text: 'API key: sk-ant-abcdefghijklmnopqrstuvwxyz0123',
      });
      expect(answer.status).toBe(400);
    });
  });

  describe('facts', () => {
    it('adds, confirms, contradicts, searches and queries by entity', async () => {
      const { asAgent } = await setup();
      const facts = asAgent['agent-facts'];
      const added = await facts.post({
        action: 'add',
        content: 'Halogen läuft auf Kingston an Port 8731',
        entities: ['Halogen', 'Kingston'],
      });
      expect(added.status).toBe(200);
      expect(added.data!.status).toBe('added');
      expect(added.data!.fact!.project).toBe('MKT');
      expect(added.data!.fact!.trust).toBeCloseTo(0.5);
      const again = await facts.post({
        action: 'add',
        content: 'halogen läuft auf kingston an port 8731',
        entities: ['Kingston', 'Halogen'],
      });
      expect(again.data!.status).toBe('confirmed');
      expect(again.data!.fact!.trust).toBeCloseTo(0.55);
      expect(again.data!.fact!.confirmations).toBe(1);

      await facts.post({
        action: 'add',
        content: 'Der Deploy-Tag ist Montag',
        entities: ['Deploy-Tag'],
      });
      const changed = await facts.post({
        action: 'add',
        content: 'Der Deploy-Tag ist Freitag nach dem Standup',
        entities: ['Deploy-Tag'],
      });
      expect(changed.data!.contradicts!.length).toBe(1);
      const listed = await facts.post({ action: 'list' });
      const monday = listed.data!.facts!.find((fact) => fact.content.includes('Montag'))!;
      expect(monday.trust).toBeCloseTo(0.4);
      expect(monday.contradictedBy).toBe(changed.data!.fact!.id);

      const found = await facts.post({ action: 'search', query: 'Port von Halogen' });
      expect(found.data!.facts![0]!.content).toContain('8731');
      const probed = await facts.post({ action: 'probe', entity: 'Kingston', limit: 1 });
      expect(probed.data!.facts![0]!.content).toContain('Kingston');
      const joined = await facts.post({
        action: 'reason',
        entities: ['Halogen', 'Kingston'],
        limit: 1,
      });
      expect(joined.data!.facts![0]!.id).toBe(added.data!.fact!.id);
    });

    it('trains trust with feedback and hides a removed fact', async () => {
      const { asAgent } = await setup();
      const added = await asAgent['agent-facts'].post({
        action: 'add',
        content: 'VERVE nutzt Shopify',
        entities: ['VERVE', 'Shopify'],
      });
      const id = added.data!.fact!.id;
      const rated = await asAgent['agent-facts']({ factId: id }).feedback.post({ helpful: true });
      expect(rated.data!.trust).toBeCloseTo(0.55);
      const removed = await asAgent['agent-facts'].post({ action: 'remove', id });
      expect(removed.data!.status).toBe('removed');
      const listed = await asAgent['agent-facts'].post({ action: 'list' });
      expect(listed.data!.facts).toEqual([]);
    });

    it("keeps a project's facts to its members", async () => {
      const { asAgent, asOther } = await setup();
      const added = await asAgent['agent-facts'].post({
        action: 'add',
        content: 'Das Marketing-Budget liegt bei Anna Schmidt',
        entities: ['Anna Schmidt'],
      });
      const id = added.data!.fact!.id;
      const listed = await asOther['agent-facts'].post({ action: 'list' });
      expect(listed.data!.facts).toEqual([]);
      const probed = await asOther['agent-facts'].post({ action: 'probe', entity: 'Anna Schmidt' });
      expect(probed.data!.facts).toEqual([]);
      const touched = await asOther['agent-facts'].post({ action: 'update', id, content: 'x y z' });
      expect(touched.status).toBe(404);
      const elsewhere = await asOther['agent-facts'].post({
        action: 'add',
        content: 'Ein Fakt für Marketing',
        project: 'MKT',
      });
      expect(elsewhere.status).toBe(403);
    });

    it('refuses a fact holding a secret', async () => {
      const { asAgent } = await setup();
      const answer = await asAgent['agent-facts'].post({
        action: 'add',
        content: 'Das Passwort: hunter2hunter2',
      });
      expect(answer.status).toBe(400);
    });

    it('lets the owner read, correct and remove the facts of an agent', async () => {
      const { asAgent, asOwner, teamId, agentId } = await setup();
      const added = await asAgent['agent-facts'].post({
        action: 'add',
        content: 'Der Newsletter geht dienstags raus',
        entities: ['Newsletter'],
      });
      const id = added.data!.fact!.id;
      const listed = await asOwner.teams({ teamId })['ai-agents']({ agentId }).facts.get();
      expect(listed.data!.map((fact) => fact.id)).toEqual([id]);
      const corrected = await asOwner
        .teams({ teamId })
        .facts({ factId: id })
        .patch({ content: 'Der Newsletter geht mittwochs raus', trust: 0.9 });
      expect(corrected.data!.fact!.content).toContain('mittwochs');
      expect(corrected.data!.fact!.trust).toBeCloseTo(0.9);
      const removed = await asOwner.teams({ teamId }).facts({ factId: id }).delete();
      expect(removed.data!.status).toBe('removed');
    });
  });

  describe('the runtime and its hand-over', () => {
    const policy = (runtime: string, helena?: Record<string, unknown>) =>
      ({
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
        runtime,
        ...(helena && { helena }),
      }) as never;

    it('knows the runtime helena only while HELENA_NATIVE_RUNTIME is on', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const asOwner = authedApi(owner.cookie);
      await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
      const before = process.env.HELENA_NATIVE_RUNTIME;
      try {
        delete process.env.HELENA_NATIVE_RUNTIME;
        const off = await createAgent(asOwner, 'MKT', {
          name: 'Off',
          username: 'off',
          runtimePolicy: policy('helena', { toolProfile: 'recherche' }),
        });
        expect(off.data!.agent.runtimePolicy.runtime).toBeUndefined();
        process.env.HELENA_NATIVE_RUNTIME = 'on';
        const on = await createAgent(asOwner, 'MKT', {
          name: 'On',
          username: 'on',
          runtimePolicy: policy('helena', {
            toolProfile: 'recherche',
            escalation: { target: 'runtime:claude', taskKinds: ['recht'] },
          }),
        });
        expect(on.data!.agent.runtimePolicy.runtime).toBe('helena');
        const snapshot = await apiKeyApi(on.data!.apiKey!)['agent-runtime'].policy.get();
        expect(snapshot.data!.helena).toEqual({
          toolProfile: 'recherche',
          escalation: { target: 'runtime:claude', taskKinds: ['recht'] },
        });
      } finally {
        if (before === undefined) delete process.env.HELENA_NATIVE_RUNTIME;
        else process.env.HELENA_NATIVE_RUNTIME = before;
      }
    });

    it('queues the follow-up run on an agent of the project on Claude Code', async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      const asOwner = authedApi(owner.cookie);
      const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
      const teamId = project.data!.teamId;
      const view = await asOwner.projects({ projectKey: 'MKT' }).get();
      const columnId = view.data!.columns[0]!.id;
      const local = await createAgent(asOwner, 'MKT', {
        name: 'Lokal',
        username: 'lokal',
        delegationDelaySec: 0,
      });
      const big = await createAgent(asOwner, 'MKT', {
        name: 'Gross',
        username: 'gross',
        runtimePolicy: policy('claude'),
      });
      const issue = (
        await asOwner
          .projects({ projectKey: 'MKT' })
          .issues.post({ columnId, title: 'Vertrag prüfen' })
      ).data!;
      await asOwner
        .issues({ issueId: issue.id })
        .patch({ delegateUserId: local.data!.agent.userId });
      const asLocal = apiKeyApi(local.data!.apiKey!);
      const claimed = (await asLocal['agent-runs'].claim.post()).data!.run!;
      const reported = await asLocal['agent-runs']({ runId: claimed.id }).result.post({
        status: 'success',
        output: 'Übergeben an claude (task-kind).',
        escalation: {
          target: 'runtime:claude',
          reason: 'task-kind',
          detail: 'recht',
          handover: 'Übergabe: Aufgabe Vertrag prüfen.',
        },
      });
      expect(reported.status).toBe(200);
      const runs = await asOwner
        .teams({ teamId })
        ['ai-agents']({ agentId: big.data!.agent.id })
        .runs.get();
      expect(runs.data!.items).toHaveLength(1);
      expect(runs.data!.items[0]).toMatchObject({ trigger: 'escalation', issueId: issue.id });
    });
  });
});
