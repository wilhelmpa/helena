import { HERMES_BRIDGE } from './hermes-bridge';
import { runCommand, stripAnsi, type CommandResult } from './process';
import type {
  CuratorStatus,
  GenAiUsage,
  LogLines,
  ReaderContext,
  RuntimeHealth,
  RuntimeReaders,
  RuntimeRequest,
  RuntimeVersion,
  SessionPage,
  SessionSearchHit,
  SessionSummary,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
} from './types';

// Hermes answers through its own interfaces only: the CLI (`sessions export`, `logs`,
// `doctor`, `curator`, `pause`) and, for what the CLI prints only for people (the session
// list and search), its state module run by Hermes' own interpreter. The runner never opens
// Hermes' files for these.

const READ_TIMEOUT_MS = 20_000;
const DOCTOR_TIMEOUT_MS = 90_000;
const CURATOR_RUN_TIMEOUT_MS = 15 * 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
// One part's text or tool payload, and the messages of one transcript page.
export const MAX_PART_CHARS = 32_000;
const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;
const MAX_LOG_LINES = 2000;

function hermesEnv(context: ReaderContext): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ...context.env,
    HERMES_HOME: context.home,
    NO_COLOR: '1',
  };
}

function hermesBin(context: ReaderContext): string {
  return context.env.HERMES_BIN ?? process.env.HERMES_BIN ?? 'hermes';
}

function hermesPython(context: ReaderContext): string {
  return context.env.HERMES_PYTHON ?? process.env.HERMES_PYTHON ?? 'python3';
}

async function hermes(
  context: ReaderContext,
  args: string[],
  timeoutMs = READ_TIMEOUT_MS,
): Promise<CommandResult> {
  return runCommand(hermesBin(context), args, {
    env: hermesEnv(context),
    cwd: context.home,
    timeoutMs,
    maxBytes: MAX_OUTPUT_BYTES,
  });
}

function failure(what: string, result: CommandResult): Error {
  const reason =
    result.code === null ? 'did not finish in time' : `exited with ${String(result.code)}`;
  const detail = stripAnsi(result.stderr).trim().split('\n').slice(-2).join(' ').slice(0, 300);
  return new Error(`hermes ${what} ${reason}${detail ? `: ${detail}` : ''}`);
}

async function bridge<T>(context: ReaderContext, request: Record<string, unknown>): Promise<T> {
  const result = await runCommand(hermesPython(context), ['-c', HERMES_BRIDGE], {
    env: hermesEnv(context),
    cwd: context.home,
    stdin: JSON.stringify(request),
    timeoutMs: READ_TIMEOUT_MS,
    maxBytes: MAX_OUTPUT_BYTES,
  });
  let answer: { ok?: boolean; result?: T; error?: string };
  try {
    answer = JSON.parse(result.stdout) as typeof answer;
  } catch {
    throw failure('state read', result);
  }
  if (!answer.ok) throw new Error(answer.error ?? 'The Hermes state read failed');
  return answer.result as T;
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
// Hermes stores times as epoch seconds.
const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : null;

// Hermes counts input tokens without the cached ones; the GenAI convention counts them in.
export function hermesUsage(row: Record<string, unknown>): GenAiUsage {
  const cacheReadTokens = num(row.cacheReadTokens ?? row.cache_read_tokens);
  const cacheWriteTokens = num(row.cacheWriteTokens ?? row.cache_write_tokens);
  return {
    inputTokens: num(row.inputTokens ?? row.input_tokens) + cacheReadTokens + cacheWriteTokens,
    outputTokens: num(row.outputTokens ?? row.output_tokens),
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: num(row.reasoningTokens ?? row.reasoning_tokens),
  };
}

// A session row as the bridge (camelCase) or `sessions export` (Hermes' own names) gives it.
export function hermesSession(row: Record<string, unknown>): SessionSummary {
  return {
    id: String(row.id ?? ''),
    title: str(row.title),
    preview: str(row.preview),
    source: str(row.source),
    model: str(row.model),
    startedAt: ms(row.startedAt ?? row.started_at),
    endedAt: ms(row.endedAt ?? row.ended_at),
    lastActiveAt: ms(row.lastActiveAt ?? row.last_activity_at ?? row.started_at),
    endReason: str(row.endReason ?? row.end_reason),
    messageCount: num(row.messageCount ?? row.message_count),
    toolCallCount: num(row.toolCallCount ?? row.tool_call_count),
    usage: hermesUsage(row),
    estimatedCostUsd:
      typeof (row.estimatedCostUsd ?? row.estimated_cost_usd) === 'number'
        ? ((row.estimatedCostUsd ?? row.estimated_cost_usd) as number)
        : null,
    parentSessionId: str(row.parentSessionId ?? row.parent_session_id),
  };
}

export function cutText(text: string, max = MAX_PART_CHARS): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  return { text: `${text.slice(0, max)}\n…`, cut: true };
}

// A tool's arguments and result arrive as JSON text; they are kept as JSON when they parse
// and are small enough to send whole, and as (cut) text otherwise.
function jsonOrText(value: unknown): { value: unknown; cut: boolean } {
  if (typeof value !== 'string') return { value: value ?? null, cut: false };
  if (value.length <= MAX_PART_CHARS) {
    try {
      return { value: JSON.parse(value) as unknown, cut: false };
    } catch {
      return { value, cut: false };
    }
  }
  const { text, cut } = cutText(value);
  return { value: text, cut };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === 'string'
          ? block
          : typeof (block as { text?: unknown })?.text === 'string'
            ? (block as { text: string }).text
            : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

interface HermesToolCall {
  id?: string;
  call_id?: string;
  function?: { name?: string; arguments?: unknown };
  name?: string;
  arguments?: unknown;
}

// One message of `sessions export` in the GenAI shape. Null for one Hermes hides from the
// transcript it shows (a rewound or display-hidden message).
export function hermesMessage(
  row: Record<string, unknown>,
): { message: TranscriptMessage; cut: boolean } | null {
  if (row.active === 0 || row.display_kind === 'hidden') return null;
  const role = str(row.role);
  if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') return null;
  let cut = false;
  const parts: TranscriptPart[] = [];
  const text = (value: string) => {
    const result = cutText(value);
    cut ||= result.cut;
    return result.text;
  };
  if (role === 'tool') {
    const response = jsonOrText(row.content);
    cut ||= response.cut;
    parts.push({
      type: 'tool_call_response',
      id: str(row.tool_call_id),
      name: str(row.tool_name),
      response: response.value,
    });
  } else {
    const reasoning = str(row.reasoning_content) ?? str(row.reasoning);
    if (role === 'assistant' && reasoning)
      parts.push({ type: 'reasoning', content: text(reasoning) });
    const body = contentText(row.content);
    if (body.trim()) parts.push({ type: 'text', content: text(body) });
    for (const call of (Array.isArray(row.tool_calls) ? row.tool_calls : []) as HermesToolCall[]) {
      const args = jsonOrText(call.function?.arguments ?? call.arguments);
      cut ||= args.cut;
      parts.push({
        type: 'tool_call',
        id: call.id ?? call.call_id ?? null,
        name: call.function?.name ?? call.name ?? 'tool',
        arguments: args.value,
      });
    }
  }
  return {
    message: {
      id: String(row.id ?? ''),
      role,
      parts,
      timestamp: ms(row.timestamp),
      finishReason: str(row.finish_reason),
    },
    cut,
  };
}

export function hermesTranscript(
  exported: Record<string, unknown>,
  offset: number,
  limit: number,
): Transcript {
  const rows = Array.isArray(exported.messages)
    ? (exported.messages as Record<string, unknown>[])
    : [];
  const messages: TranscriptMessage[] = [];
  let truncated = false;
  for (const row of rows) {
    const mapped = hermesMessage(row);
    if (!mapped) continue;
    messages.push(mapped.message);
    truncated ||= mapped.cut;
  }
  const page = messages.slice(offset, offset + limit);
  const session = hermesSession(exported);
  return {
    session: { ...session, messageCount: session.messageCount || messages.length },
    messages: page,
    offset,
    totalMessages: messages.length,
    truncated,
  };
}

// Hermes' session ids are timestamps with a suffix; anything else is refused before it
// reaches a command line.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function sessionId(value: string): string {
  if (!SESSION_ID.test(value)) throw new Error('The session id is invalid');
  return value;
}

async function transcript(
  context: ReaderContext,
  request: Extract<RuntimeRequest, { op: 'sessions.transcript' }>,
): Promise<Transcript> {
  const id = sessionId(request.sessionId);
  const result = await hermes(context, [
    'sessions',
    'export',
    '--session-id',
    id,
    '--format',
    'jsonl',
    '--redact',
    '-',
  ]);
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('{'));
  if (!line) {
    if (result.code === 0 || /not found/i.test(result.stdout)) {
      throw new Error('Session not found');
    }
    throw failure('sessions export', result);
  }
  const offset = Math.max(0, request.offset ?? 0);
  const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_PAGE), MAX_PAGE);
  return hermesTranscript(JSON.parse(line) as Record<string, unknown>, offset, limit);
}

async function logs(
  context: ReaderContext,
  request: Extract<RuntimeRequest, { op: 'logs.read' }>,
): Promise<LogLines> {
  const lines = Math.min(Math.max(1, request.lines ?? 200), MAX_LOG_LINES);
  const level =
    request.level && /^(DEBUG|INFO|WARNING|ERROR)$/.test(request.level) ? request.level : null;
  const result = await hermes(context, [
    'logs',
    'agent',
    '-n',
    String(lines),
    ...(request.sessionId ? ['--session', sessionId(request.sessionId)] : []),
    ...(level ? ['--level', level] : []),
  ]);
  if (result.code !== 0) throw failure('logs', result);
  const out = stripAnsi(result.stdout)
    .split('\n')
    .filter((line) => line.trim() && !/^--- .* ---$/.test(line.trim()));
  return { lines: out.slice(-lines), truncated: result.overflow };
}

async function health(context: ReaderContext): Promise<RuntimeHealth> {
  const result = await hermes(context, ['doctor'], DOCTOR_TIMEOUT_MS);
  const report = stripAnsi(result.stdout).trim();
  if (!report) throw failure('doctor', result);
  return { ok: result.code === 0 && !report.includes('✗'), report, checkedAt: Date.now() };
}

// `Hermes Agent v0.21.4 (2026.9.21) · upstream 3c6c1323 · local 80cb510b (+1 carried commit)`
export function parseHermesVersion(output: string): RuntimeVersion {
  const detail = stripAnsi(output).split('\n')[0]?.trim() || null;
  const version = /\bv(\d+\.\d+\.\d+[^\s]*)/.exec(detail ?? '')?.[1] ?? null;
  return { runtime: 'hermes', version, detail };
}

async function version(context: ReaderContext): Promise<RuntimeVersion> {
  const result = await hermes(context, ['--version']);
  if (result.code !== 0) throw failure('--version', result);
  return parseHermesVersion(result.stdout);
}

async function curatorStatus(context: ReaderContext): Promise<CuratorStatus> {
  const result = await hermes(context, ['curator', 'status']);
  if (result.code !== 0) throw failure('curator status', result);
  const report = stripAnsi(result.stdout).trim();
  const state = /^curator:\s*(\w+)/im.exec(report)?.[1]?.toUpperCase();
  return { paused: state ? state === 'PAUSED' : null, report };
}

async function curatorRun(context: ReaderContext): Promise<{ report: string }> {
  const result = await hermes(context, ['curator', 'run'], CURATOR_RUN_TIMEOUT_MS);
  if (result.code !== 0) throw failure('curator run', result);
  return { report: stripAnsi(result.stdout).trim().slice(-8000) };
}

// A skill name as Hermes names a skill directory; never one that reads as an option.
const SKILL_NAME = /^[A-Za-z0-9][\w.-]{0,127}$/;

// Pinning a skill so the curator never archives or changes it, or unpinning it. Whether the
// curator works at all is the agent's setting, which the runner applies as its pause.
async function curatorSet(
  context: ReaderContext,
  request: Extract<RuntimeRequest, { op: 'curator.set' }>,
): Promise<CuratorStatus> {
  if (request.action !== 'pin' && request.action !== 'unpin') throw new Error('Unknown action');
  if (!SKILL_NAME.test(request.skill)) throw new Error('Not a skill name');
  const result = await hermes(context, ['curator', request.action, request.skill]);
  if (result.code !== 0) throw failure(`curator ${request.action}`, result);
  return curatorStatus(context);
}

// Hermes' own emergency stop: while the ESTOP file is in the profile, its scheduler, board
// dispatch and gateway start no new work. Helena stops handing out runs itself.
async function estop(
  context: ReaderContext,
  request: Extract<RuntimeRequest, { op: 'estop.set' }>,
): Promise<{ engaged: boolean }> {
  const reason = (request.reason ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  const result = request.engaged
    ? await hermes(context, ['pause', ...(reason ? ['--reason', reason] : [])])
    : await hermes(context, ['resume']);
  if (result.code !== 0) throw failure(request.engaged ? 'pause' : 'resume', result);
  return { engaged: request.engaged };
}

export const hermesReaders: RuntimeReaders = {
  runtime: 'hermes',
  ops: [
    'sessions.list',
    'sessions.search',
    'sessions.transcript',
    'logs.read',
    'health.check',
    'version.read',
    'curator.status',
    'curator.run',
    'curator.set',
    'estop.set',
  ],
  async handle(request, context) {
    switch (request.op) {
      case 'sessions.list': {
        const page = await bridge<{ sessions: Record<string, unknown>[]; total: number }>(context, {
          op: 'list',
          limit: request.limit,
          offset: request.offset,
        });
        return {
          sessions: page.sessions.map(hermesSession),
          total: page.total,
        } satisfies SessionPage;
      }
      case 'sessions.search': {
        const found = await bridge<{ hits: Record<string, unknown>[] }>(context, {
          op: 'search',
          query: request.query,
          limit: request.limit,
        });
        return found.hits.map((hit): SessionSearchHit => ({
          sessionId: String(hit.sessionId),
          role: str(hit.role),
          snippet: typeof hit.snippet === 'string' ? cutText(hit.snippet, 600).text : '',
          session: hit.session ? hermesSession(hit.session as Record<string, unknown>) : null,
        }));
      }
      case 'sessions.transcript':
        return transcript(context, request);
      case 'logs.read':
        return logs(context, request);
      case 'health.check':
        return health(context);
      case 'version.read':
        return version(context);
      case 'curator.status':
        return curatorStatus(context);
      case 'curator.run':
        return curatorRun(context);
      case 'curator.set':
        return curatorSet(context, request);
      case 'estop.set':
        return estop(context, request);
    }
  },
};
