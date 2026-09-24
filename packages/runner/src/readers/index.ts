import { Redactor } from '../redact';
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
  claude: claudeReaders,
  codex: codexReaders,
};

export function readersFor(runtime: string | undefined): RuntimeReaders | null {
  return (runtime && READERS[runtime]) || null;
}

// What the runtime status reports, so Helena offers only what the runtime answers.
export function readerCapabilities(runtime: string | undefined): string[] {
  const readers = readersFor(runtime);
  return readers ? [...new Set(readers.ops.map((op) => REQUEST_CAPABILITY[op]))] : [];
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
