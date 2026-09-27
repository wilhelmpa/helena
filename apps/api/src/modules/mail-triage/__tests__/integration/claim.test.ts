import { beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  db,
  helenaMailTriageClaim,
  helenaMailClassification,
  helenaDecisionClassSetting,
  helenaReceipt,
  type MailTriageRuntime,
  vaultEntry,
  project as projectTable,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { runProjectTriage } from '../../classify';
import { MAIL_CLASS } from '#modules/decisions/classes';
import { withProjectTriageClaim } from '../../claim';
import { disconnectProxy } from '../fixtures/pg-disconnect.fixture';

const apiRoot = resolve(import.meta.dir, '../../../../..');
const recovery = resolve(
  apiRoot,
  '../../deployment/volition-stack/native/mail-triage-claim-recover.py',
);
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Triage test deadline')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function setup(count = 1) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const projects = [];
  for (let n = 0; n < count; n++) {
    const result = await api.projects.post({ key: `CLAIM${n}`, name: `Claim ${n}` });
    expect(result.status).toBe(201);
    projects.push(result.data!);
  }
  return projects;
}
function child(projectId: number, mode: string, databaseUrl = process.env.DATABASE_URL!) {
  return Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      resolve(import.meta.dir, '../fixtures/claim-child.fixture.ts'),
      String(projectId),
      mode,
    ],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}
interface ClaimSnapshot {
  project_id: number;
  run_token: string;
  runtime: MailTriageRuntime;
  started_at: string;
}
async function claimRow(projectId: number) {
  const rows = await db.execute(
    sql`SELECT to_jsonb(c) AS claim FROM helena_mail_triage_claim c WHERE project_id=${projectId}`,
  );
  return rows[0]?.claim as ClaimSnapshot | undefined;
}
async function waitNoSessions(name: string) {
  await bounded(
    (async () => {
      while (true) {
        const rows = await db.execute(
          sql`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name=${name}`,
        );
        if (rows[0]?.count === 0) return;
        await Bun.sleep(10);
      }
    })(),
  );
}
function recoveryPlan(row: ClaimSnapshot) {
  const code =
    "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('r',sys.argv[1]); r=importlib.util.module_from_spec(s); s.loader.exec_module(r); c=json.load(sys.stdin); print(json.dumps({'proof':r.dead_runtime(c['runtime']),'sessions':r.session_statement(c['runtime']),'release':r.release_statement(c)}))";
  const result = spawnSync('python3', ['-B', '-c', code, recovery], {
    input: JSON.stringify(row),
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { proof: string; sessions: string; release: string };
}

async function receiptProjects(count: number, perProject = 1) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const projects = [];
  for (let n = 0; n < count; n++) {
    const p = (await api.projects.post({ key: `CLAIMREAL${n}`, name: `Claim real ${n}` })).data!;
    projects.push(p);
    const { accountId, inboxId } = await insertMailAccount(
      p.teamId,
      p.id,
      `claim${n}@home.example`,
    );
    for (let m = 0; m < perProject; m++) {
      const message = await insertMessage({
        teamId: p.teamId,
        accountId,
        folderId: inboxId,
        projectId: p.id,
        subject: 'Payment receipt',
        text: `Amount paid: ${20 + n + m}.00 EUR`,
      });
      await db.insert(helenaMailClassification).values({
        teamId: p.teamId,
        threadId: message.threadId,
        messageId: message.messageRowId,
        status: 'classified',
        projectId: p.id,
        category: 'invoice',
        actions: [
          {
            kind: 'receipt',
            projectId: p.id,
            receiptIds: [],
            note: 'No supported receipt original found.',
          },
        ],
      });
    }
  }
  await db.insert(helenaDecisionClassSetting).values({
    teamId: projects[0]!.teamId,
    classId: MAIL_CLASS,
    enabled: true,
    updatedByUserId: owner.userId,
    config: { receipts: 'auto', task: 'off', since: '2026-01-01T00:00:00Z' },
  });
  return projects;
}

// Uses real migrated private PostgreSQL and real child-process lifetimes. No model,
// provider or private message content is involved. Native /proc recovery is Linux-specific.
describe.skipIf(process.platform !== 'linux')('durable project triage claim', () => {
  beforeEach(resetDb);

  test('ten real project runs file classified receipts through intake, indexing and matching without a batch transaction', async () => {
    const projects = await receiptProjects(10);
    const first = await bounded(Promise.all(projects.map((p) => runProjectTriage(p, 10))));
    expect(first.every((result) => result.processed === 0 && result.failed === 0)).toBe(true);
    let filed = first.reduce((sum, result) => sum + result.receiptRetries, 0);
    for (const p of projects) filed += (await bounded(runProjectTriage(p, 10))).receiptRetries;
    expect(filed).toBe(10);
    for (const p of projects) {
      const receipts = await db
        .select()
        .from(helenaReceipt)
        .where(eq(helenaReceipt.projectId, p.id));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.source).toBe('mail');
      expect(
        await db.select().from(vaultEntry).where(eq(vaultEntry.path, receipts[0]!.vaultPath)),
      ).toHaveLength(1);
      expect((await runProjectTriage(p, 10)).receiptRetries).toBe(0);
    }
    expect(await db.select().from(helenaMailTriageClaim)).toHaveLength(0);
  }, 30_000);

  test('ten different projects retain claims without retaining pool connections', async () => {
    const projects = await setup(10);
    const release = deferred();
    const allEntered = deferred();
    let entered = 0;
    const work = Promise.all(
      projects.map((p) =>
        withProjectTriageClaim(p.id, async () => {
          if (++entered === 10) allEntered.resolve();
          await release.promise;
          await db.execute(sql`SELECT 1`);
        }),
      ),
    );
    try {
      await bounded(allEntered.promise);
      expect(await db.select().from(helenaMailTriageClaim)).toHaveLength(10);
      await bounded(db.execute(sql`SELECT 1`));
    } finally {
      release.resolve();
      await bounded(work);
    }
    expect(await db.select().from(helenaMailTriageClaim)).toHaveLength(0);
  });

  test('other replicas and nine simultaneous calls cannot enter the same project', async () => {
    const [p] = await setup();
    const worker = child(p!.id, 'hold');
    try {
      const reader = worker.stdout.getReader();
      expect(new TextDecoder().decode((await bounded(reader.read())).value)).toContain('HELD');
      reader.releaseLock();
      let entered = 0;
      const attempts = await Promise.allSettled(
        Array.from({ length: 9 }, () =>
          withProjectTriageClaim(p!.id, async () => {
            entered++;
          }),
        ),
      );
      expect(attempts.every((r) => r.status === 'rejected')).toBe(true);
      expect(entered).toBe(0);
      worker.stdin.end();
      expect(await bounded(worker.exited)).toBe(0);
      await withProjectTriageClaim(p!.id, async () => {
        entered++;
      });
      expect(entered).toBe(1);
    } finally {
      worker.kill();
      await worker.exited;
    }
  });

  test('request abort finishes the real current intake and stops before the next receipt', async () => {
    const [p] = await receiptProjects(1, 2);
    const signal = new AbortController();
    const namespace = 'triage_' + randomUUID().replaceAll('-', '');
    const lock = 741925;
    await db.execute(
      sql.raw(`CREATE SCHEMA ${namespace};
      CREATE FUNCTION ${namespace}.pause_intake() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$;
      CREATE TRIGGER triage_pause_intake BEFORE INSERT ON helena_receipt
      FOR EACH ROW EXECUTE FUNCTION ${namespace}.pause_intake()`),
    );
    const held = deferred();
    const unlock = deferred();
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lock})`);
      held.resolve();
      await unlock.promise;
    });
    await held.promise;
    const work = runProjectTriage(p!, 10, signal.signal).catch((error) => error);
    try {
      await bounded(
        (async () => {
          while (true) {
            const rows =
              await db.execute(sql`SELECT count(*)::integer AS count FROM pg_stat_activity
            WHERE wait_event_type='Lock' AND query LIKE '%insert into "helena_receipt"%'`);
            if (Number(rows[0]!.count) > 0) return;
            await Bun.sleep(10);
          }
        })(),
      );
      signal.abort();
      await expect(runProjectTriage(p!, 10)).rejects.toThrow('Root recovery');
      expect(await db.select().from(helenaReceipt)).toHaveLength(0);
    } finally {
      unlock.resolve();
      await blocker;
      await bounded(work);
      await db.execute(
        sql.raw(
          `DROP TRIGGER triage_pause_intake ON helena_receipt; DROP SCHEMA ${namespace} CASCADE`,
        ),
      );
    }
    expect((await work).code).toBe('mail_triage_cancelled');
    expect(await claimRow(p!.id)).toBeUndefined();
    const receipts = await db.select().from(helenaReceipt);
    expect(receipts).toHaveLength(1);
    expect(
      await db.select().from(vaultEntry).where(eq(vaultEntry.path, receipts[0]!.vaultPath)),
    ).toHaveLength(1);
    expect((await runProjectTriage(p!, 10)).receiptRetries).toBe(1);
    expect(await db.select().from(helenaReceipt)).toHaveLength(2);
  });

  test('real backend termination cannot release the claim before its late callback ends', async () => {
    const [p] = await setup();
    const worker = child(p!.id, 'late-transaction');
    try {
      const reader = worker.stdout.getReader();
      const first = new TextDecoder().decode((await bounded(reader.read())).value);
      reader.releaseLock();
      const { backend } = JSON.parse(first.trim()) as { backend: number };
      await db.execute(sql`SELECT pg_terminate_backend(${backend})`);
      await Bun.sleep(50);
      expect(worker.exitCode).toBeNull();
      expect(await claimRow(p!.id)).toBeDefined();
      await expect(withProjectTriageClaim(p!.id, async () => {})).rejects.toThrow('Root recovery');
      worker.stdin.end();
      expect(await bounded(worker.exited)).toBe(1);
      // The driver cannot prove backend completion just from a close event, so
      // even this deliberately terminated connection leaves recovery evidence.
      const row = await claimRow(p!.id);
      expect(row).toBeDefined();
      const [after] = await db.select().from(projectTable).where(eq(projectTable.id, p!.id));
      expect(after!.name).toBe('Late callback completed');
      await waitNoSessions(row!.runtime.databaseRuntimeName);
      const proof = recoveryPlan(row!);
      expect(Number((await db.execute(sql.raw(proof.release)))[0]!.count)).toBe(1);
    } finally {
      worker.kill();
      await worker.exited;
    }
  });

  test('caught client loss retains the claim while the real backend write remains blocked', async () => {
    const [p] = await setup();
    const held = deferred();
    const unlock = deferred();
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM project WHERE id=${p!.id} FOR NO KEY UPDATE`);
      held.resolve();
      await unlock.promise;
    });
    const proxy = await disconnectProxy(process.env.DATABASE_URL!, 'work-query');
    await held.promise;
    const worker = child(p!.id, 'write-catch', proxy.url);
    try {
      expect(await bounded(worker.exited)).toBe(1);
      expect(JSON.parse((await new Response(worker.stdout).text()).trim())).toEqual({
        succeeded: false,
        workStarted: true,
      });
      expect(proxy.fired()).toBe(true);
      const row = await claimRow(p!.id);
      expect(row).toBeDefined();
      await expect(withProjectTriageClaim(p!.id, async () => {})).rejects.toThrow('Root recovery');
      const proof = recoveryPlan(row!);
      // A dead OS process alone is insufficient: its proxied PG session still
      // owns a blocked, real mutation. The Root operator must refuse recovery.
      expect(Number((await db.execute(sql.raw(proof.sessions)))[0]!.count)).toBeGreaterThan(0);
      const waiting = await db.execute(sql`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE application_name=${row!.runtime.databaseRuntimeName} AND wait_event_type='Lock'`);
      expect(waiting[0]!.count).toBe(1);
      unlock.resolve();
      await blocker;
      await bounded(
        (async () => {
          while (true) {
            const [after] = await db.select().from(projectTable).where(eq(projectTable.id, p!.id));
            if (after!.name === 'Backend completed after client loss') return;
            await Bun.sleep(10);
          }
        })(),
      );
      expect(await claimRow(p!.id)).toEqual(row);
      await proxy.close();
      await waitNoSessions(row!.runtime.databaseRuntimeName);
      expect(Number((await db.execute(sql.raw(proof.release)))[0]!.count)).toBe(1);
    } finally {
      unlock.resolve();
      await blocker;
      worker.kill();
      await worker.exited;
      await proxy.close();
    }
  });

  test('a completed callback with deferred real COMMIT still retains the claim', async () => {
    const [p] = await setup();
    const namespace = 'triage_' + randomUUID().replaceAll('-', '');
    const lock = 741924;
    const held = deferred();
    const unlock = deferred();
    const callbackDone = deferred();
    await db.execute(
      sql.raw(`CREATE SCHEMA ${namespace}; CREATE TABLE ${namespace}.probe(id integer);
      CREATE FUNCTION ${namespace}.at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER deferred_probe AFTER INSERT ON ${namespace}.probe DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ${namespace}.at_commit()`),
    );
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lock})`);
      held.resolve();
      await unlock.promise;
    });
    let ended = false;
    let work: Promise<unknown> | undefined;
    try {
      await held.promise;
      work = withProjectTriageClaim(p!.id, async () => {
        void db.transaction(async (tx) => {
          await tx.execute(sql.raw(`INSERT INTO ${namespace}.probe VALUES (1)`));
          callbackDone.resolve();
        });
        await callbackDone.promise;
        throw new Error('Outer work failed');
      })
        .finally(() => {
          ended = true;
        })
        .catch((error) => error);
      await bounded(callbackDone.promise);
      await Bun.sleep(30);
      expect(ended).toBe(false);
      await expect(withProjectTriageClaim(p!.id, async () => {})).rejects.toThrow('Root recovery');
    } finally {
      unlock.resolve();
      await blocker;
      if (work) await bounded(work);
      await db.execute(sql.raw(`DROP SCHEMA ${namespace} CASCADE`));
    }
    expect(await claimRow(p!.id)).toBeUndefined();
  });

  for (const mode of ['acquire-response', 'release-query'] as const) {
    test(`${mode} loss leaves a durable claim and never repeats work`, async () => {
      const [p] = await setup();
      const proxy = await disconnectProxy(process.env.DATABASE_URL!, mode);
      const worker = child(p!.id, 'finish', proxy.url);
      try {
        expect(await bounded(worker.exited)).toBe(1);
        const result = JSON.parse((await new Response(worker.stdout).text()).trim());
        expect(result).toEqual({ succeeded: false, workStarted: mode === 'release-query' });
        expect(proxy.fired()).toBe(true);
        const row = await claimRow(p!.id);
        expect(row).toBeDefined();
        await expect(withProjectTriageClaim(p!.id, async () => {})).rejects.toThrow(
          'Root recovery',
        );
        await waitNoSessions(row!.runtime.databaseRuntimeName);
        const proof = recoveryPlan(row!);
        expect(proof.proof).toBe('process-absent');
        expect(Number((await db.execute(sql.raw(proof.sessions)))[0]!.count)).toBe(0);
        expect(Number((await db.execute(sql.raw(proof.release)))[0]!.count)).toBe(1);
      } finally {
        worker.kill();
        await worker.exited;
        await proxy.close();
      }
    });
  }

  test('crash retains claim; actual process end and exact token/full row are required for recovery', async () => {
    const [p] = await setup();
    const worker = child(p!.id, 'hold');
    try {
      const reader = worker.stdout.getReader();
      expect(new TextDecoder().decode((await bounded(reader.read())).value)).toContain('HELD');
      reader.releaseLock();
      const old = await claimRow(p!.id);
      expect(old).toBeDefined();
      worker.kill('SIGKILL');
      await bounded(worker.exited);
      await waitNoSessions(old!.runtime.databaseRuntimeName);
      await expect(withProjectTriageClaim(p!.id, async () => {})).rejects.toThrow('Root recovery');
      const proof = recoveryPlan(old!);
      expect(proof.proof).toBe('process-absent');
      await db
        .update(helenaMailTriageClaim)
        .set({ runToken: randomUUID() })
        .where(eq(helenaMailTriageClaim.projectId, p!.id));
      expect(Number((await db.execute(sql.raw(proof.release)))[0]!.count)).toBe(0);
      const changed = await claimRow(p!.id);
      const fresh = recoveryPlan(changed!);
      expect(Number((await db.execute(sql.raw(fresh.release)))[0]!.count)).toBe(1);
      await withProjectTriageClaim(p!.id, async () => {});
    } finally {
      worker.kill();
      await worker.exited;
    }
  });
});
