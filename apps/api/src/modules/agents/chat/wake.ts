import { sql } from 'drizzle-orm';
import { db, listen } from '@repo/db';

// Wakes the chat streams of an answer as soon as its runner reports events or the answer
// ends, instead of each stream polling the database every few hundred milliseconds: the
// writes NOTIFY a channel (inside their transaction, so the rows are committed by the time
// a stream reads them), and one LISTEN per API process wakes the streams following that
// answer. The database stays the log — a stream still reads what it sends from the table
// — and the poll stays as the fallback for what no NOTIFY covers (a janitor closing an
// answer, a LISTEN connection that is down).
export const CHAT_CHANGE_CHANNEL = 'helena_chat_change';

const waiters = new Map<number, Set<() => void>>();
let listening: Promise<unknown> | null = null;

function ensureListening() {
  listening ??= listen(CHAT_CHANGE_CHANNEL, (payload) => {
    const set = waiters.get(Number(payload));
    if (set) for (const wake of [...set]) wake();
  }).catch((error: unknown) => {
    // Try again with the next stream; until then the poll carries the streams.
    listening = null;
    console.warn('[chat] LISTEN failed, streams fall back to polling', error);
  });
}

// Watches one answer from now on: `next` resolves at its next change, or after `ms` at the
// latest. Created before a stream reads, so a change that lands during the read is not
// missed; `stop` lets go of it.
export function watchChatAnswer(
  messageId: number,
  ms: number,
): { next: Promise<void>; stop: () => void } {
  ensureListening();
  let stop = () => {};
  const next = new Promise<void>((resolve) => {
    const set = waiters.get(messageId) ?? new Set<() => void>();
    waiters.set(messageId, set);
    const timer = setTimeout(() => stop(), ms);
    stop = () => {
      clearTimeout(timer);
      set.delete(stop);
      if (set.size === 0) waiters.delete(messageId);
      resolve();
    };
    set.add(stop);
  });
  return { next, stop: () => stop() };
}

type Executor = Pick<typeof db, 'execute'>;

// Tells the streams of an answer that it changed. Inside a transaction the NOTIFY is
// delivered at commit.
export async function notifyChatAnswer(messageId: number, executor: Executor = db) {
  await executor.execute(sql`select pg_notify(${CHAT_CHANGE_CHANNEL}, ${String(messageId)})`);
}
