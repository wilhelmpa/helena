import { expect, test } from 'bun:test';
import {
  observeTransactionCallbacks,
  withSettledTransactionCallbacks,
} from './transaction-callbacks';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('outside the scope the original callback, options and returned promise are unchanged', () => {
  const output = Promise.resolve(7);
  const work = async () => 7;
  const options = { isolationLevel: 'serializable' };
  const original = {
    transaction: (fn: unknown, opts: unknown) => {
      expect(fn).toBe(work);
      expect(opts).toBe(options);
      return output;
    },
  };
  const observed = observeTransactionCallbacks(original);
  expect(observed.transaction(work, options)).toBe(output);
  expect(original.transaction).not.toBe(observed.transaction);
});

test('connection-close rejection waits for actual callback and late child callbacks', async () => {
  const entered = deferred();
  const release = deferred();
  const childEntered = deferred();
  const childRelease = deferred();
  const dropped = deferred<never>();
  const database = observeTransactionCallbacks({
    transaction: (work: () => Promise<void>) => Promise.race([work(), dropped.promise]),
  });
  let released = false;
  const result = withSettledTransactionCallbacks(async () => {
    await database.transaction(async () => {
      entered.resolve();
      await release.promise;
      await database.transaction(async () => {
        childEntered.resolve();
        await childRelease.promise;
      });
    });
  }).finally(() => {
    released = true;
  });
  const observed = result.catch((error) => error);
  await entered.promise;
  dropped.reject(new Error('connection closed'));
  await Bun.sleep(0);
  expect(released).toBe(false);
  release.resolve();
  await childEntered.promise;
  await Bun.sleep(0);
  expect(released).toBe(false);
  childRelease.resolve();
  expect((await observed).message).toBe('connection closed');
  expect(released).toBe(true);
});

test('normal callback errors propagate after complete settlement', async () => {
  const database = observeTransactionCallbacks({
    transaction: (work: () => Promise<void>) => work(),
  });
  await expect(
    withSettledTransactionCallbacks(() =>
      database.transaction(async () => {
        throw new Error('ordinary failure');
      }),
    ),
  ).rejects.toThrow('ordinary failure');
});

test('a detached child remains tracked through pool wait and commit after its callback ends', async () => {
  const pool = deferred();
  const commit = deferred();
  const callbackDone = deferred();
  const database = observeTransactionCallbacks({
    transaction: async (work: () => Promise<void>) => {
      await pool.promise;
      await work();
      callbackDone.resolve();
      await commit.promise;
    },
  });
  let released = false;
  const run = withSettledTransactionCallbacks(async () => {
    void database.transaction(async () => {});
    throw new Error('outer driver closed');
  })
    .finally(() => {
      released = true;
    })
    .catch((error) => error);
  await Bun.sleep(0);
  expect(released).toBe(false);
  pool.resolve();
  await callbackDone.promise;
  await Bun.sleep(0);
  expect(released).toBe(false);
  commit.resolve();
  expect((await run).message).toBe('outer driver closed');
  expect(released).toBe(true);
});

// The real driver's lazy Query is exercised without opening a database socket.
const queryModule = new URL('./query.js', import.meta.resolve('postgres')).href;
interface DriverQuery extends Promise<unknown> {
  isRaw?: string;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  values(): DriverQuery;
}
interface BoundClient {
  unsafe(): DriverQuery;
}
const { Query } = (await import(queryModule)) as {
  Query: new (
    strings: string[],
    args: unknown[],
    handler: (query: DriverQuery) => void,
  ) => DriverQuery;
};
const { observePostgresQueries } = await import('./transaction-callbacks');

test('query observation preserves lazy values selection and original identity outside scope', async () => {
  let executions = 0;
  let query!: DriverQuery;
  const client = observePostgresQueries({
    unsafe: () =>
      (query = new Query(['SELECT 1'], [], (q: DriverQuery) => {
        executions++;
        expect(q.isRaw).toBe('values');
        q.resolve([[1]]);
      })),
    begin: (work: (client: BoundClient) => Promise<unknown>) => work(client),
  });
  const outside = client.unsafe();
  expect(outside).toBe(query);
  expect(executions).toBe(0);
  expect(await outside.values()).toEqual([[1]]);
  let uncertain: boolean | undefined;
  await withSettledTransactionCallbacks(
    async () => {
      const pending = client.unsafe();
      expect(pending).toBe(query);
      expect(executions).toBe(1);
      expect(await pending.values()).toEqual([[1]]);
    },
    (value) => {
      uncertain = value;
    },
  );
  expect(uncertain).toBe(false);
});

for (const [label, failure, expected] of [
  [
    'caught transport loss',
    Object.assign(new Error('closed'), { code: 'CONNECTION_CLOSED' }),
    true,
  ],
  [
    'confirmed constraint rejection',
    Object.assign(new Error('duplicate'), { name: 'PostgresError', code: '23505' }),
    false,
  ],
  [
    'shutdown response',
    Object.assign(new Error('shutdown'), { name: 'PostgresError', code: '57P01' }),
    true,
  ],
] as const) {
  test(`${label} is visible after domain catch, including a transaction-bound client`, async () => {
    const raw = {
      unsafe: () => new Query(['SELECT 1'], [], (q: DriverQuery) => q.reject(failure)),
      begin: async (work: (client: BoundClient) => Promise<unknown>) => work(raw),
    };
    const client = observePostgresQueries(raw);
    let uncertain: boolean | undefined;
    await withSettledTransactionCallbacks(
      () =>
        client.begin(async (bound: BoundClient) => {
          await bound
            .unsafe()
            .values()
            .catch(() => {});
        }),
      (value) => {
        uncertain = value;
      },
    );
    expect(uncertain).toBe(expected);
  });
}

test('a lost COMMIT response retains uncertainty after the callback succeeded', async () => {
  const database = observeTransactionCallbacks({
    transaction: async (work: () => Promise<void>) => {
      await work();
      throw Object.assign(new Error('lost commit'), { code: 'CONNECTION_CLOSED' });
    },
  });
  let uncertain: boolean | undefined;
  await withSettledTransactionCallbacks(
    async () => {
      await database.transaction(async () => {}).catch(() => {});
    },
    (value) => {
      uncertain = value;
    },
  );
  expect(uncertain).toBe(true);
});
