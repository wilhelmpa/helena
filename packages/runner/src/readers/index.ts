import { runShort } from '../cli-runtime';
import { Redactor } from '../redact';
import { answerLimitsRead, limitsCapable } from '../limits';
import { answerLoginRead } from '../runtime-account';
import { nativeReaders } from './native';
import { hermesReaders } from './hermes';
import { claudeReaders, codexReaders } from './jsonl';
import {
  REQUEST_CAPABILITY,
  type ReaderContext,
  type RuntimeReaders,
  type RuntimeRequest,
} from './types';

export type { ReaderContext, RuntimeReaders, RuntimeRequest, RuntimeRequestOp } from './types';

// The reading side of each runtime adapter the runner knows. A runtime missing here, or an
// op missing from its `ops`, is reported to Helena as a capability it does not have.
const READERS: Record<string, RuntimeReaders> = {
  hermes: hermesReaders,
  helena: nativeReaders,
  claude: claudeReaders,
  codex: codexReaders,
};

export function readersFor(runtime: string | undefined): RuntimeReaders | null {
  return (runtime && READERS[runtime]) || null;
}

// What the runtime status reports, so Helena offers only what the runtime answers.
export function readerCapabilities(runtime: string | undefined): string[] {
  const readers = readersFor(runtime);
  const ops = readers ? readers.ops.map((op) => REQUEST_CAPABILITY[op]) : [];
  // Plan limits are read by the usage-limit sources (limits/), not by the readers.
  if (limitsCapable(runtime)) ops.push(REQUEST_CAPABILITY['limits.read']);
  return [...new Set(ops)];
}

// Helena refuses a larger answer; a transcript that big is asked for in pages.
export const MAX_ANSWER_BYTES = 6 * 1024 * 1024;

const OPS = new Set(Object.keys(REQUEST_CAPABILITY));

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { op?: unknown }).op === 'string' &&
    OPS.has((value as { op: string }).op)
  );
}

// Answers one request with the agent's runtime adapter. What leaves here goes through the
// runner's redaction, over the runtime's own: the exact secrets the runner handed the agent
// are masked whatever the runtime printed.
export async function answerRuntimeRequest(
  request: RuntimeRequest,
  context: ReaderContext,
  redactor: Redactor = new Redactor(),
): Promise<unknown> {
  if (request.op === 'limits.read') {
    // Numbers only; the redaction still runs over them.
    return redactor.value(await answerLimitsRead(request, context));
  }
  if (request.op === 'login.read') {
    // The account's facts only, as the runtime tells them (runtime-account.ts).
    return redactor.value(await answerLoginRead(context, runShort));
  }
  if (request.op === 'login.logout') {
    // Signed out by the runtime's own command, in the agent's unit (cli-runtime.ts).
    throw new Error('A sign-out is not answered here');
  }
  const readers = readersFor(context.runtime);
  if (!readers || !readers.ops.includes(request.op)) {
    throw new Error(`The ${context.runtime} runtime cannot answer ${request.op}`);
  }
  const result = await redactor.value(await readers.handle(request, context));
  if (Buffer.byteLength(JSON.stringify(result ?? null), 'utf8') > MAX_ANSWER_BYTES) {
    throw new Error('The answer is too large; ask for a smaller page');
  }
  return result;
}
