import { spyOn } from 'bun:test';
import * as knowledge from '@helena/knowledge';

const reindexItems = knowledge.reindexItems;
const pending = new Map<Promise<void>, string>();
let failures: unknown[] = [];

// Keep the real indexer, including source reads and transactions, owned by the test.
spyOn(knowledge, 'reindexItems').mockImplementation((source, ids) => {
  const work = reindexItems(source, ids);
  pending.set(work, `${source.id}: ${ids.join(', ')}`);
  void work.then(
    () => pending.delete(work),
    (error: unknown) => {
      failures.push(error);
      pending.delete(work);
    },
  );
  return work;
});

export async function drainReindexes(timeoutMs = 3_000): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (pending.size) await Promise.allSettled([...pending.keys()]);
      })(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error(
                `Test reindex did not drain; reset blocked: ${[...pending.values()].join('; ')}`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    if (failures.length) {
      const errors = failures;
      failures = [];
      throw new AggregateError(errors, 'Test reindex failed; reset blocked');
    }
  } finally {
    clearTimeout(deadline);
  }
}
