import { beforeEach, expect, spyOn, test } from 'bun:test';
import { agentSessionSource, reindexItems } from '@helena/knowledge';
import { db, helenaAgentSession, knowledgeItem } from '@repo/db';
import { sql } from 'drizzle-orm';
import { compactSession } from '#modules/agents/native-runtime/sessions';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { createAgent } from './agents';
import { apiKeyApi, authedApi } from './app';
import { signUpTestUser } from './auth';
import { resetDb } from './db';
import { drainReindexes } from './reindex';

beforeEach(resetDb);

async function sessionFixture() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'VOL', name: 'Volition test' });
  const created = (
    await createAgent(api, 'VOL', { name: 'Indexer', username: 'indexer', kind: 'external' })
  ).data!;
  const runner = apiKeyApi(created.apiKey!);
  const session = (await runner['agent-runtime'].sessions.post({ kind: 'run' })).data!;
  return { session, agent: (await getRunnerAgent(created.agent.userId))! };
}

test('reset joins detached session reindexing through source reads and the final transaction', async () => {
  const { session, agent } = await sessionFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const get = agentSessionSource.get;
  const delayed = spyOn(agentSessionSource, 'get').mockImplementation(async (id) => {
    entered.resolve();
    await release.promise;
    return get(id);
  });
  let reset: Promise<void> | undefined;
  try {
    await compactSession(agent, session.id, 'Indexed summary', 1);
    await entered.promise;
    let finished = false;
    reset = resetDb().then(() => {
      finished = true;
    });
    await Bun.sleep(25);
    expect(finished).toBe(false);
    expect(await db.select().from(helenaAgentSession)).toHaveLength(1);
    release.resolve();
    await reset;
    expect(await db.select().from(helenaAgentSession)).toHaveLength(0);
    expect(await db.select().from(knowledgeItem)).toHaveLength(0);
  } finally {
    release.resolve();
    await reset;
    await drainReindexes();
    delayed.mockRestore();
  }
});

test('a failed reindex refuses the reset and preserves the test rows', async () => {
  await sessionFixture();
  const error = new Error('Source read failed');
  await expect(
    reindexItems(
      {
        ...agentSessionSource,
        get: async () => {
          throw error;
        },
      },
      ['broken'],
    ),
  ).rejects.toThrow(error.message);
  await expect(resetDb()).rejects.toThrow('Test reindex failed; reset blocked');
  expect(await db.select().from(helenaAgentSession)).toHaveLength(1);
});

test('reset joins the session index transaction holding knowledge_item while knowledge_chunk is locked', async () => {
  const { session, agent } = await sessionFixture();
  const locked = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const blocker = db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE knowledge_chunk IN ACCESS EXCLUSIVE MODE`);
    const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    locked.resolve(row!.pid);
    await release.promise;
  });
  let reset: Promise<void> | undefined;
  try {
    const pid = await locked.promise;
    await compactSession(agent, session.id, 'Locked summary', 1);
    const deadline = Date.now() + 2_000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      const rows = await db.execute(sql`
        SELECT 1 FROM pg_stat_activity a
        JOIN pg_locks l ON l.pid = a.pid
        WHERE ${pid} = ANY(pg_blocking_pids(a.pid))
          AND a.query LIKE 'delete from "knowledge_chunk"%'
          AND l.relation = 'knowledge_item'::regclass
          AND l.mode = 'RowExclusiveLock' AND l.granted
      `);
      waiting = rows.length > 0;
      if (!waiting) await Bun.sleep(10);
    }
    expect(waiting).toBe(true);
    reset = resetDb();
    await Bun.sleep(25);
    expect(await db.select().from(helenaAgentSession)).toHaveLength(1);
    release.resolve();
    await blocker;
    await reset;
    expect(await db.select().from(knowledgeItem)).toHaveLength(0);
  } finally {
    release.resolve();
    await blocker;
    await reset;
    await drainReindexes();
  }
});

test('a drain deadline reports the source and leaves its work owned until completion', async () => {
  const release = Promise.withResolvers<void>();
  const work = reindexItems(
    {
      ...agentSessionSource,
      get: async () => {
        await release.promise;
        return null;
      },
    },
    ['delayed'],
  );
  try {
    await expect(drainReindexes(20)).rejects.toThrow('agent-session: delayed');
  } finally {
    release.resolve();
    await work;
    await drainReindexes();
  }
});
