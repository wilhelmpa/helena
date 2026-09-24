import type { OutputFormat } from './config';

// What one run, chat answer or reflection spent in total, for Helena's token ledger: every
// model call summed, with the model that ran. The counts follow the OpenTelemetry GenAI
// conventions: input includes the cached reads and writes, output includes reasoning.
// agui.ts UsageReader reads something else, the size of the context after the last call.

export interface Spend {
  runtime: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number | null;
}

type Line = Record<string, unknown>;
type Counts = Pick<
  Spend,
  'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'
>;

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export class SpendReader {
  private buffered = '';
  private model: string | null = null;
  private counted = false;
  private readonly total: Counts = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
  private reportedDuration: number | null = null;
  private readonly started = Date.now();

  constructor(
    private readonly format: OutputFormat,
    private readonly runtime: string | null,
  ) {}

  write(chunk: string): void {
    if (this.format === 'text') return;
    this.buffered += chunk;
    const lines = this.buffered.split('\n');
    this.buffered = lines.pop() ?? '';
    for (const line of lines) this.read(line);
  }

  // `model` and `provider` are what the task asked for, used where the output names none.
  value(fallback: { model?: string | null; provider?: string | null } = {}): Spend | null {
    if (this.buffered) {
      this.read(this.buffered);
      this.buffered = '';
    }
    if (!this.counted) return null;
    return {
      runtime: this.runtime,
      model: this.model ?? fallback.model ?? null,
      provider: fallback.provider ?? null,
      ...this.total,
      durationMs: this.reportedDuration ?? Date.now() - this.started,
    };
  }

  private add(counts: Partial<Counts>): void {
    this.counted = true;
    for (const key of Object.keys(this.total) as (keyof Counts)[]) {
      this.total[key] += counts[key] ?? 0;
    }
  }

  private read(text: string): void {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return;
    let line: Line;
    try {
      line = JSON.parse(trimmed) as Line;
    } catch {
      return;
    }
    switch (this.format) {
      case 'hermes-stream-json':
        return this.readHermes(line);
      case 'claude-stream-json':
        return this.readClaude(line);
      case 'codex-jsonl':
        return this.readCodex(line);
      case 'opencode-json':
        return this.readOpencode(line);
      default:
        return;
    }
  }

  // The init line names the model; the result line sums the session's calls, with input
  // counted without the cache.
  private readHermes(line: Line): void {
    if (line.type === 'system') this.model = str(line.model) ?? this.model;
    if (line.type !== 'result' || !line.tokens || typeof line.tokens !== 'object') return;
    const tokens = line.tokens as Line;
    const cacheRead = num(tokens.cache_read);
    const cacheWrite = num(tokens.cache_write);
    this.add({
      inputTokens: num(tokens.input) + cacheRead + cacheWrite,
      outputTokens: num(tokens.output),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: num(tokens.reasoning),
    });
    if (typeof line.duration_ms === 'number') this.reportedDuration = line.duration_ms;
  }

  // The closing result line sums every call of the answer.
  private readClaude(line: Line): void {
    if (line.type === 'system' && line.subtype === 'init')
      this.model = str(line.model) ?? this.model;
    if (line.type !== 'result' || !line.usage || typeof line.usage !== 'object') return;
    const usage = line.usage as Line;
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    this.add({
      inputTokens: num(usage.input_tokens) + cacheRead + cacheWrite,
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    });
    if (typeof line.duration_ms === 'number') this.reportedDuration = line.duration_ms;
  }

  // One turn.completed per turn; its input already includes the cached tokens.
  private readCodex(line: Line): void {
    if (line.type !== 'turn.completed' || !line.usage || typeof line.usage !== 'object') return;
    const usage = line.usage as Line;
    this.add({
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cached_input_tokens),
      reasoningTokens: num(usage.reasoning_output_tokens),
    });
  }

  private readOpencode(line: Line): void {
    const part = line.part as Line | undefined;
    if (part?.type !== 'step-finish' || !part.tokens || typeof part.tokens !== 'object') return;
    const tokens = part.tokens as Line;
    const cache = (tokens.cache ?? {}) as Line;
    this.add({
      inputTokens: num(tokens.input) + num(cache.read) + num(cache.write),
      outputTokens: num(tokens.output) + num(tokens.reasoning),
      cacheReadTokens: num(cache.read),
      cacheWriteTokens: num(cache.write),
      reasoningTokens: num(tokens.reasoning),
    });
  }
}
