import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { aiAgent, agentRun, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { JUDGE_SYSTEM_PROMPT, JUDGE_WORK_CLASS } from '../../judge-prompt';
import { currentJudge } from '../../judge';

// The judge of the Deutsch-Texte eval as a text-only run (docs/helena-decisions/halogen.md §7):
// the Administrator sets it, a judge call queues a digest-style run with the judge's own system
// prompt on the chosen subscription model, the runner answers, the eval reads the score.

afterAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

async function ownerWithHermesAgent() {
  const user = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(user.cookie);
  await api.projects.post({ key: 'PRIV', name: 'Privat' });
  const created = await createAgent(api, 'PRIV', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
  });
  const agent = created.data!.agent;
  await db
    .update(aiAgent)
    .set({ runtimeState: { adapter: 'hermes', capabilities: ['digest-runs'] }, lastSeenAt: null })
    .where(eq(aiAgent.id, agent.id));
  return { api, agent, runner: apiKeyApi(created.data!.apiKey!) };
}

describe('the local AI judge', () => {
  it('is the Administrator’s to read and set, never showing a key', async () => {
    const { api, agent } = await ownerWithHermesAgent();
    const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
    expect((await member.god['local-ai'].judge.get()).status).toBe(403);

    const read = await api.god['local-ai'].judge.get();
    expect(read.status).toBe(200);
    expect(read.data).toMatchObject({ kind: 'run', model: 'gpt-6-sol', hasKey: false });
    expect(read.data!.agents.map((entry) => entry.id)).toEqual([agent.id]);

    const bad = await api.god['local-ai'].judge.put({ kind: 'endpoint', baseUrl: 'ftp://x' });
    expect(bad.status).toBe(400);

    const saved = await api.god['local-ai'].judge.put({
      kind: 'endpoint',
      baseUrl: 'https://judge.example/v1',
      model: 'judge-model',
      key: 'sk-secret-judge',
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ kind: 'endpoint', model: 'judge-model', hasKey: true });
    expect(JSON.stringify(saved.data)).not.toContain('sk-secret-judge');
  });

  it('asks through a text-only run with its own system prompt, never on a local model', async () => {
    const { api, agent, runner } = await ownerWithHermesAgent();
    await api.god['local-ai'].judge.put({ kind: 'run', model: 'gpt-6-sol', reasoning: 'medium' });
    const judge = await currentJudge();
    expect(judge).not.toBeNull();

    const answer = judge!({
      system: 'Bewerte den Text. Antworte als JSON {"score": 0-100}.',
      prompt: 'Aufgabe: Support-Antwort\nAntwort: Wir senden Ersatz.',
      json: true,
    });
    // The runner claims the run: the prompt as queued, the judge's system prompt, the model.
    let claimed: {
      id: number;
      systemPrompt: string;
      prompt: string;
      model?: string | null;
    } | null = null;
    for (let i = 0; i < 50 && !claimed; i++) {
      claimed = (await runner['agent-runs'].claim.post()).data?.run ?? null;
      if (!claimed) await Bun.sleep(100);
    }
    expect(claimed).not.toBeNull();
    expect(claimed!.systemPrompt).toBe(JUDGE_SYSTEM_PROMPT);
    expect(claimed!.prompt).toBe(
      'Anweisung: Bewerte den Text. Antworte als JSON {"score": 0-100}.\n\n' +
        'Aufgabe: Support-Antwort\nAntwort: Wir senden Ersatz.',
    );
    expect(claimed!.model).toBe('gpt-6-sol');
    const [row] = await db.select().from(agentRun).where(eq(agentRun.id, claimed!.id));
    expect(row).toMatchObject({
      trigger: 'digest',
      workClass: JUDGE_WORK_CLASS,
      agentId: agent.id,
      issueId: null,
    });

    const report = await runner['agent-runs']({ runId: claimed!.id }).result.post({
      status: 'success',
      output: '{"score": 84, "reason": "sachlich"}',
      sessionId: 'session-judge',
      runtime: {
        requested: { model: 'gpt-6-sol', reasoning: 'medium' },
        defaults: null,
        used: { model: 'gpt-6-sol', reasoning: 'medium', provider: 'openai-codex' },
      },
    });
    expect(report.status).toBe(200);
    expect((await answer).text).toBe('{"score": 84, "reason": "sachlich"}');
  });

  it('is off when the Administrator switches it off', async () => {
    const { api } = await ownerWithHermesAgent();
    await api.god['local-ai'].judge.put({ kind: 'off' });
    expect(await currentJudge()).toBeNull();
  });
});
