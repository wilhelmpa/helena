import { AsyncLocalStorage } from 'node:async_hooks';

// postgres-js may reject begin() on connection close before its async callback ends.
// A caller protecting external work must retain ownership through those callbacks too.
interface Scope {
  pending: Set<Promise<unknown>>;
  uncertain: boolean;
}
const callbacks = new AsyncLocalStorage<Scope>();

function observeFailure(scope: Scope, error: unknown): void {
  // A PostgreSQL ErrorResponse confirms the statement stopped. Connection-class
  // errors and shutdowns do not establish completion of earlier client work.
  const value = error as { name?: string; code?: string } | null;
  if (
    value?.name === 'PostgresError' &&
    /^[0-9A-Z]{5}$/.test(value.code ?? '') &&
    !value.code!.startsWith('08') &&
    !['57P01', '57P02', '57P03'].includes(value.code!)
  )
    return;
  scope.uncertain = true;
}

function track<T>(pending: Set<Promise<unknown>>, promise: Promise<T>): Promise<T> {
  pending.add(promise);
  promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise),
  );
  return promise;
}

export async function withSettledTransactionCallbacks<T>(
  work: () => Promise<T>,
  onSettled?: (uncertain: boolean) => void,
): Promise<T> {
  const scope: Scope = { pending: new Set(), uncertain: false };
  return callbacks.run(scope, async () => {
    try {
      return await work();
    } finally {
      // A still-running callback may start further transactions after connection loss.
      while (scope.pending.size) await Promise.allSettled([...scope.pending]);
      onSettled?.(scope.uncertain);
    }
  });
}

// Drizzle's postgres-js adapter uses unsafe(), including on begin()'s bound
// client. Observe its actual Promise without invoking Query.then(): that would
// start a lazy query before Drizzle applies .values(). No query is rewritten.
export function observePostgresQueries<T extends object>(client: T): T {
  const driver = client as unknown as {
    unsafe: (...args: unknown[]) => Promise<unknown>;
    begin: (...args: unknown[]) => unknown;
  };
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'unsafe')
        return (...args: unknown[]) => {
          const query = driver.unsafe(...args);
          const scope = callbacks.getStore();
          if (scope)
            track(
              scope.pending,
              Promise.prototype.then.call(
                query,
                () => undefined,
                (error: unknown) => observeFailure(scope, error),
              ),
            );
          return query;
        };
      if (property === 'begin')
        return (...args: unknown[]) => {
          if (!callbacks.getStore()) return driver.begin(...args);
          const callbackIndex = typeof args[0] === 'function' ? 0 : 1;
          const work = args[callbackIndex] as (bound: T) => unknown;
          args[callbackIndex] = (bound: T) => work(observePostgresQueries(bound));
          return driver.begin(...args);
        };
      return Reflect.get(target, property, receiver);
    },
  });
}

// Construct a facade once; never replace a method on the ORM/client. Without the
// explicit scope, arguments and return value go directly to the original transaction.
export function observeTransactionCallbacks<T extends object>(database: T): T {
  const transaction = (
    database as unknown as {
      transaction: (
        work: (...args: unknown[]) => Promise<unknown>,
        ...options: unknown[]
      ) => Promise<unknown>;
    }
  ).transaction.bind(database);
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return (work: (...args: unknown[]) => Promise<unknown>, ...options: unknown[]) => {
        const scope = callbacks.getStore();
        if (!scope) return transaction(work, ...options);
        const { pending } = scope;
        let actual: Promise<unknown> | undefined;
        let callbackFailure: unknown;
        const complete = (async () => {
          try {
            return await transaction(
              (...args: unknown[]) => {
                actual = track(
                  pending,
                  Promise.resolve()
                    .then(() => work(...args))
                    .catch((error) => {
                      callbackFailure = error;
                      throw error;
                    }),
                );
                return actual;
              },
              ...options,
            );
          } catch (error) {
            if (error !== callbackFailure) observeFailure(scope, error);
            throw error;
          } finally {
            // Keep per-mail catch/finally paths from advancing while the callback
            // still runs. Also retain the driver lifetime through pool wait/commit.
            if (actual) await actual.catch(() => {});
          }
        })();
        return track(pending, complete);
      };
    },
  });
}
