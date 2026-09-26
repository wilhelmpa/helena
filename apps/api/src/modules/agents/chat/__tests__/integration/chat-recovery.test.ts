import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq } from 'drizzle-orm';
import { agentChatEvent, agentChatMessage, agentChatThread, db } from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { answer as runAnswer } from '../../../../../../../../packages/runner/src/chat';
import { Client } from '../../../../../../../../packages/runner/src/client';
import type { RunnerConfig } from '../../../../../../../../packages/runner/src/config';

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function startApi(port = 0) {
  const cwd = fileURLToPath(new URL('../../../../../../', import.meta.url));
  const script = `const {app}=await import(${JSON.stringify(join(cwd, 'src/app.ts'))}); app.listen({hostname:'127.0.0.1',port:${port}}); console.log('RECOVERY_PORT '+app.server.port);`;
  const child = spawn(process.execPath, ['-e', script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  };
  cleanup.push(stop);
  let output = '';
  child.stdout.on('data', (part: Buffer) => {
    output += part.toString();
  });
  child.stderr.resume();
  const deadline = Date.now() + 10_000;
  while (!/RECOVERY_PORT (\d+)/.test(output)) {
    if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline)
      throw new Error('Private recovery API did not start');
    await sleep(20);
  }
  const bound = Number(/RECOVERY_PORT (\d+)/.exec(output)![1]);
  return { port: bound, url: `http://127.0.0.1:${bound}`, stop };
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Recovery owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'REC', name: 'Recovery' });
  const created = await createAgent(asOwner, 'REC', {
    name: 'Recovery agent',
    username: 'recovery',
    kind: 'external',
  });
  const runner = apiKeyApi(created.data!.apiKey!);
  const chat = asOwner.projects({ projectKey: 'REC' })['ai-agents']({
    agentId: created.data!.agent.id,
  });
  const sent = (await chat.chat.post({ prompt: 'Synthetic recovery task' })).data!;
  const claimed = (await runner['agent-chats'].claim.post()).data!.message!;
  return {
    agentId: created.data!.agent.id,
    apiKey: created.data!.apiKey!,
    cookie: owner.cookie,
    asOwner,
    runner,
    chat,
    claimed,
    sent,
    api: runner['agent-chats']({ messageId: claimed.id }),
  };
}

describe('chat delivery recovery', () => {
  beforeEach(resetDb);

  it('finishes the same live command after an actual private API process restart and resumes its persisted stream', async () => {
    const fixture = await setup();
    const first = await startApi();
    const dir = await mkdtemp(join(tmpdir(), 'chat-api-recovery-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const resume = join(dir, 'continue');
    const config: RunnerConfig = {
      name: 'synthetic-recovery',
      url: first.url,
      apiKey: fixture.apiKey,
      command: `printf 'once\\n' >> "$EXECUTION_LOG"; printf '%s\\n' '{"type":"system","session_id":"private-recovery-session"}' '{"type":"text","text":"Before restart. "}' '{"type":"tool_use","tool_call_id":"tool-1","name":"fixture_write","input":{}}' '{"type":"tool_result","tool_call_id":"tool-1","output":"synthetic-file-hash"}'; while [ ! -f "$CONTINUE" ]; do sleep 0.05; done; printf '%s\\n' '{"type":"text","text":"Done."}' '{"type":"result","text":"Before restart. Done.","session_id":"private-recovery-session"}'`,
      args: [],
      cwd: dir,
      env: { EXECUTION_LOG: join(dir, 'executions'), CONTINUE: resume },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 15_000,
      outputFormat: 'hermes-stream-json',
      models: [],
    };
    const stop = new AbortController();
    const running = runAnswer(config, new Client(config), fixture.claimed, stop, null);
    cleanup.push(async () => {
      stop.abort();
      await running.catch(() => {});
    });
    const streamPath = `/projects/REC/ai-agents/${fixture.agentId}/chat/${fixture.claimed.id}/stream`;
    const response = await fetch(first.url + streamPath, { headers: { cookie: fixture.cookie } });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let received = '';
    while (!received.includes('synthetic-file-hash')) {
      const part = await reader.read();
      if (part.done) throw new Error('Private stream ended before the tool result');
      received += new TextDecoder().decode(part.value);
    }
    const ids = [...received.matchAll(/^id: (\d+)$/gm)];
    const cursor = ids.at(-1)![1]!;
    await first.stop();
    await reader.cancel().catch(() => {});
    await writeFile(resume, 'continue');
    await sleep(250);
    const second = await startApi(first.port);
    await running;
    const continued = await fetch(second.url + streamPath, {
      headers: { cookie: fixture.cookie, 'Last-Event-ID': cursor },
    });
    expect(continued.status).toBe(200);
    const tail = await continued.text();
    expect(tail).toContain('Done.');
    expect(tail).not.toContain('synthetic-file-hash');
    const [stored] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, fixture.claimed.id));
    expect(stored).toMatchObject({
      status: 'success',
      attempts: 1,
      content: 'Before restart. Done.',
      sessionId: 'private-recovery-session',
    });
    const events = await db
      .select()
      .from(agentChatEvent)
      .where(eq(agentChatEvent.messageId, fixture.claimed.id));
    expect(
      events.filter((row) => (row.payload as { type: string }).type === 'TOOL_CALL_RESULT'),
    ).toHaveLength(1);
    expect(await readFile(join(dir, 'executions'), 'utf8')).toBe('once\n');
    expect((await fixture.runner['agent-chats'].claim.post()).data?.message).toBeNull();
  }, 30_000);

  it('acknowledges a committed batch twice without duplicating text, tool results or session binding', async () => {
    const { api, claimed, sent } = await setup();
    const batch = {
      delivery: { claim: claimed.attempts, offset: 0 },
      sessionId: 'synthetic-recovery-session',
      events: [
        { type: 'TEXT_MESSAGE_CONTENT' as const, messageId: 'm', delta: 'Once. ' },
        { type: 'TOOL_CALL_START' as const, toolCallId: 't', toolCallName: 'fixture_write' },
        {
          type: 'TOOL_CALL_RESULT' as const,
          messageId: 'm',
          toolCallId: 't',
          content: 'file-hash:synthetic',
        },
      ],
    };
    const responses = await Promise.all([api.events.post(batch), api.events.post(batch)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await api.events.post(batch)).status).toBe(200);
    const [stored] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, claimed.id));
    expect(stored?.content).toBe('Once. ');
    expect(stored?.sessionId).toBe(batch.sessionId);
    const [thread] = await db
      .select()
      .from(agentChatThread)
      .where(eq(agentChatThread.id, sent.threadId));
    expect(thread?.cliSessionId).toBe(batch.sessionId);
    const events = await db
      .select()
      .from(agentChatEvent)
      .where(eq(agentChatEvent.messageId, claimed.id));
    expect(events).toHaveLength(3);
    expect(
      events.filter((event) => (event.payload as { type: string }).type === 'TOOL_CALL_RESULT'),
    ).toHaveLength(1);
    expect(
      (
        await api.events.post({
          ...batch,
          events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Different' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await api.events.post({ ...batch, delivery: { ...batch.delivery, offset: 9 } })).status,
    ).toBe(409);
    expect((await api.events.post({ ...batch, sessionId: 'different-session' })).status).toBe(409);
    expect(
      (
        await api.events.post({
          delivery: { claim: claimed.attempts, offset: 3 },
          events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Done.' }],
        })
      ).status,
    ).toBe(200);
    const [ended] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, claimed.id));
    expect(ended?.content).toBe('Once. Done.');
  });

  it('keeps the terminal result idempotent after a lost acknowledgement and rejects conflicting status', async () => {
    const { api, claimed, runner } = await setup();
    const options = { query: { claim: claimed.attempts } };
    expect((await api.result.post({ status: 'success' }, options)).status).toBe(204);
    expect((await api.result.post({ status: 'success' }, options)).status).toBe(204);
    expect(
      (await api.result.post({ status: 'failed', error: 'late failure' }, options)).status,
    ).toBe(404);
    expect((await runner['agent-chats'].claim.post()).data?.message).toBeNull();
    const [stored] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, claimed.id));
    expect(stored?.status).toBe('success');
    expect(stored?.lastError).toBeNull();
    expect(stored?.attempts).toBe(1);
  });

  it('rejects events, heartbeats and results from an expired claim after a new claim owns the answer', async () => {
    const { api, claimed, runner } = await setup();
    await db
      .update(agentChatMessage)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(agentChatMessage.id, claimed.id));
    const newer = (await runner['agent-chats'].claim.post()).data!.message!;
    expect(newer.id).toBe(claimed.id);
    expect(newer.attempts).toBe(claimed.attempts + 1);
    const old = { query: { claim: claimed.attempts } };
    expect((await api.heartbeat.post(undefined, old)).status).toBe(404);
    expect(
      (
        await api.events.post({
          delivery: { claim: claimed.attempts, offset: 0 },
          events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'stale' }],
        })
      ).status,
    ).toBe(404);
    expect((await api.result.post({ status: 'success' }, old)).status).toBe(404);
    expect((await api.result.post({ status: 'failed', sessionLost: true }, old)).status).toBe(404);
    expect((await api.heartbeat.post(undefined, { query: { claim: newer.attempts } })).status).toBe(
      200,
    );
    const [stored] = await db
      .select()
      .from(agentChatMessage)
      .where(
        and(eq(agentChatMessage.id, claimed.id), eq(agentChatMessage.attempts, newer.attempts)),
      );
    expect(stored?.status).toBe('streaming');
    expect(stored?.content).toBe('');
  });
});
