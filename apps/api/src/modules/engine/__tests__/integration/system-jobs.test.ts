import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { db, helenaSystemJob } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { resetDb } from '#tests/helpers/db';
import {
  resetEngineDb,
  startEngine,
  stopTestEngine,
  testEngineExecutions,
} from '#tests/helpers/engine';
import {
  fireDueSystemJobs,
  registerSystemJob,
  runSystemJobNow,
  systemJobState,
  type SystemJobSchedule,
} from '../../system-jobs';

setDefaultTimeout(30_000);

// The engine's instance-level jobs (the update center's check is the first): fired at their
// cron times once, as a durable workflow with recorded steps, and started by hand.

const JOB = 'helena.test-job';
let schedule: SystemJobSchedule = { enabled: true, cron: '* * * * *', timezone: 'Europe/Berlin' };
const ran: { trigger: string; scheduledFor: string | null }[] = [];
let fail = false;

registerSystemJob({
  id: JOB,
  schedule: async () => schedule,
  async run(context) {
    const first = await context.step('first', async () => 'one');
    await context.sleep(10);
    await context.step('second', async () => {
      if (fail) throw new Error('the test job failed');
      ran.push({
        trigger: context.trigger,
        scheduledFor: context.scheduledFor?.toISOString() ?? null,
      });
      return first;
    });
  },
});

async function row() {
  const [found] = await db.select().from(helenaSystemJob).where(eq(helenaSystemJob.id, JOB));
  return found ?? null;
}

async function waitForStatus(status: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const found = await row();
    if (found?.lastStatus === status) return found;
    if (Date.now() > deadline)
      throw new Error(`the job did not reach ${status}: ${JSON.stringify(found)}`);
    await Bun.sleep(50);
  }
}

beforeAll(startEngine);
afterAll(stopTestEngine);

beforeEach(async () => {
  await resetEngineDb();
  ran.length = 0;
  fail = false;
  schedule = { enabled: true, cron: '* * * * *', timezone: 'Europe/Berlin' };
});

describe('system jobs', () => {
  it('joins a cancelled job holding an application transaction before resetting tables', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const joined = Promise.withResolvers<void>();
    const id = 'helena.test-held-transaction';
    let finished = false;
    registerSystemJob({
      id,
      schedule: async () => ({ enabled: false, cron: '0 0 1 1 *', timezone: 'UTC' }),
      async run(context) {
        await context.step('held-transaction', async () => {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select id from helena_system_job where id = ${id} for update`);
            entered.resolve();
            await release.promise;
          });
          finished = true;
        });
      },
    });
    await runSystemJobNow(id);
    await entered.promise;
    const entry = [...testEngineExecutions()].find(([key]) => key.startsWith(`job:${id}:`))![1];
    const execution = entry.promise;
    // Observe a join of the real held execution without guessing a delay. Merely
    // cancelling its durable status or closing the SDK does not await this promise.
    entry.promise = {
      then(onfulfilled, onrejected) {
        joined.resolve();
        return execution.then(onfulfilled, onrejected);
      },
    } as Promise<unknown>;
    const stopping = stopTestEngine();
    try {
      expect(
        await Promise.race([joined.promise.then(() => 'joined'), stopping.then(() => 'stopped')]),
      ).toBe('joined');
      expect(finished).toBe(false);
    } finally {
      release.resolve();
      await stopping;
      await execution;
    }
    expect(finished).toBe(true);
    await resetDb();
    expect(await db.select().from(helenaSystemJob)).toEqual([]);
  });

  it('start afresh when first seen, then fire each due time once', async () => {
    const now = new Date();
    // First seen: nothing is due yet. (Other registered jobs may be ticked too; only this
    // one's row and runs are looked at.)
    await fireDueSystemJobs(now);
    expect((await row())!.firedThrough.getTime()).toBe(now.getTime());
    expect((await row())!.lastStatus).toBeNull();

    // Two minutes later the newest minute fires, once, whoever ticks.
    const later = new Date(now.getTime() + 125_000);
    await fireDueSystemJobs(later);
    const firedThrough = (await row())!.firedThrough.getTime();
    expect(firedThrough).toBeGreaterThan(now.getTime());
    await fireDueSystemJobs(later);
    expect((await row())!.firedThrough.getTime()).toBe(firedThrough);
    await waitForStatus('succeeded');
    await Bun.sleep(200);
    expect(ran).toHaveLength(1);
    expect(ran[0]!.trigger).toBe('schedule');
    expect(new Date(ran[0]!.scheduledFor!).getSeconds()).toBe(0);
    expect((await row())!.lastWorkflowId).toContain(`job:${JOB}:`);
  });

  it('a new schedule starts afresh; a switched off one fires nothing', async () => {
    const now = new Date();
    await fireDueSystemJobs(now);
    schedule = { ...schedule, cron: '*/5 * * * *' };
    const later = new Date(now.getTime() + 600_000);
    await fireDueSystemJobs(later);
    expect((await row())!).toMatchObject({
      scheduleKey: '*/5 * * * *|Europe/Berlin',
      lastStatus: null,
    });
    expect((await row())!.firedThrough.getTime()).toBe(later.getTime());
    schedule = { ...schedule, enabled: false };
    await fireDueSystemJobs(new Date(later.getTime() + 900_000));
    expect((await row())!.firedThrough.getTime()).toBe(later.getTime());
    expect(ran).toHaveLength(0);
    expect((await systemJobState(JOB)).nextRunAt).toBeNull();
  });

  it('runs a job that asks for it once when it is first seen', async () => {
    // Registered here, under an id of its own: the first sight is once per id and database.
    let eagerRuns = 0;
    registerSystemJob({
      id: `helena.test-eager-${Date.now()}`,
      runWhenNew: true,
      // Once a year: only the first sight runs it within the test.
      schedule: async () => ({ enabled: true, cron: '0 0 1 1 *', timezone: 'Europe/Berlin' }),
      async run(context) {
        await context.step('count', async () => {
          eagerRuns += 1;
        });
      },
    });
    await fireDueSystemJobs();
    await fireDueSystemJobs();
    const deadline = Date.now() + 10_000;
    while (eagerRuns === 0 && Date.now() < deadline) await Bun.sleep(50);
    await Bun.sleep(200);
    expect(eagerRuns).toBe(1);
  });

  it('runs by hand, records a failure with its reason', async () => {
    expect((await runSystemJobNow(JOB)).started).toBe(true);
    await waitForStatus('succeeded');
    expect(ran.map((entry) => entry.trigger)).toEqual(['manual']);
    fail = true;
    await runSystemJobNow(JOB);
    const failed = await waitForStatus('failed');
    expect(failed.lastError).toBe('the test job failed');
    const state = await systemJobState(JOB);
    expect(state).toMatchObject({ lastStatus: 'failed', lastTrigger: 'manual' });
    expect(state.nextRunAt).not.toBeNull();
  });
});
