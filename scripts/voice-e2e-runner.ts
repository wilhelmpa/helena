// A stand-in for an agent's runner in the voice E2E (scripts/voice-e2e.mjs): claims the agent's
// chat answers and answers each after the time Hermes takes on Kingston (measured 2026-09-26:
// the text ~4.7 s after the claim, the answer closed ~1.5 s after its text), so the E2E sees
// the same shape — including the gap between the last sentence and the answer's end, which the
// conversation no longer waits for.
//
//   bun scripts/voice-e2e-runner.ts --api http://localhost:25600 --key-file <file> \
//     [--first-ms 4700] [--close-ms 1500]
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] ?? '']);
    return pairs;
  }, []),
);
const API = args.api ?? 'http://localhost:25600';
const KEY = readFileSync(args['key-file']!, 'utf8').trim();
const FIRST_MS = Number(args['first-ms'] ?? 4700);
const CLOSE_MS = Number(args['close-ms'] ?? 1500);
const ANSWER =
  args.answer ?? 'Du hast drei offene Aufgaben. Die wichtigste ist die Checkout-Seite für Verve.';

const post = async (path: string, body?: unknown) => {
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

console.log('fake runner up');
for (;;) {
  try {
    const claimed = (await post('/agent-chats/claim')) as {
      message: { id: number; prompt: string } | null;
    };
    const message = claimed?.message;
    if (!message) continue;
    console.log(`claimed ${message.id}: ${message.prompt.slice(-80)}`);
    const messageId = `msg-${message.id}`;
    await post(`/agent-chats/${message.id}/events`, {
      events: [{ type: 'RUN_STARTED', runId: String(message.id) }],
    });
    await sleep(FIRST_MS);
    await post(`/agent-chats/${message.id}/events`, {
      events: [
        { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: ANSWER },
      ],
    });
    await sleep(CLOSE_MS);
    await post(`/agent-chats/${message.id}/events`, {
      events: [{ type: 'TEXT_MESSAGE_END', messageId }, { type: 'RUN_FINISHED', runId: String(message.id) }],
    });
    await post(`/agent-chats/${message.id}/result`, { status: 'success' });
  } catch (error) {
    console.error(String(error));
    await sleep(1000);
  }
}
