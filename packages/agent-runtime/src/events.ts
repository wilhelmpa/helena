// What the loop writes on stdout: one JSON object per line, the format `helena-jsonl` the
// runner reads (packages/runner, runtime `helena`). The first eight kinds are @helena/sdk's
// RuntimeStreamEvent, so the runner's AG-UI stream turns them into the chat and the run's
// timeline as it does for every other runtime. `spend`, `escalate` and `result` close a
// command: what the whole run cost, a hand-over to a bigger model, and the answer.

export type AgentEvent =
  | { type: 'session'; id: string }
  | { type: 'model'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | {
      type: 'status';
      status: 'model-queued';
      model: string;
      message: string;
      retryAfterMs: number;
      remainingMs: number;
    }
  | { type: 'tool-call'; id: string; name: string; input: string }
  | {
      type: 'tool-result';
      id: string;
      output: string;
      isError?: boolean;
      outcome?: 'ok' | 'nonzero_with_output' | 'error';
      exitCode?: number | null;
    }
  // The context size of the last model call (tokens read, cache included, and written).
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | SpendEvent
  | EscalateEvent
  | ResultEvent;

// Summed over every model call of the command (OpenTelemetry GenAI counts: input includes
// the cached tokens, output the reasoning).
export interface SpendEvent {
  type: 'spend';
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number;
  steps: number;
  toolCalls: number;
}

// The loop gives the task to a bigger model it does not drive itself (Claude Code or Codex
// with the owner's subscriptions): Helena starts that run with the hand-over.
export interface EscalateEvent {
  type: 'escalate';
  target: string;
  reason: EscalationReason;
  detail: string;
  handover: string;
}

export type EscalationReason = 'task-kind' | 'uncertain' | 'failure' | 'pinned';

export interface ResultEvent {
  type: 'result';
  text: string;
  exitCode: number;
  // Why the command did not finish, in English and without a secret: 'budget', 'aborted',
  // 'loop', 'model-unavailable', 'escalated', 'error'.
  reason?: string;
  error?: string;
}

export interface EventSink {
  emit(event: AgentEvent): void;
}

// Writes each event as one line. Text is JSON-escaped, so a newline in an answer never
// breaks a line.
export class JsonLineSink implements EventSink {
  constructor(private readonly write: (line: string) => void) {}

  emit(event: AgentEvent): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
}

// Collects the events, for tests and for callers that read them afterwards (the evals).
export class MemorySink implements EventSink {
  readonly events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(event);
  }

  text(): string {
    return this.events
      .filter((event): event is Extract<AgentEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.delta)
      .join('');
  }

  of<T extends AgentEvent['type']>(type: T): Extract<AgentEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<AgentEvent, { type: T }> => event.type === type,
    );
  }
}
