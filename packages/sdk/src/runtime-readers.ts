// What a runtime adapter can read back from the runtime it drives, and the controls it
// offers besides running work (contract of hub/hermes-in-helena, "Gläserne Läufe"). Helena
// asks through runtime requests (the runner claims /agent-runtime/requests/claim and
// answers /agent-runtime/requests/:id/answer); the runner answers them with the adapter of
// the agent's runtime. Memory is not a reader (it stays in the policy inventory), and
// usage is reported by runs as spend, not read from the runtime. The shapes follow the OpenTelemetry
// GenAI semantic conventions: messages are `gen_ai.input/output.messages` with typed parts,
// token counts are `gen_ai.usage.*`.

// input_tokens includes the cached reads and writes, output_tokens the reasoning tokens.
export interface GenAiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export type TranscriptPart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; id: string | null; name: string; arguments: unknown }
  | {
      type: 'tool_call_response';
      id: string | null;
      name: string | null;
      response: unknown;
      isError?: boolean;
    }
  | { type: 'compaction'; content: string | null };

export interface TranscriptMessage {
  // The runtime's own id of the message, unique within the session.
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: TranscriptPart[];
  // Epoch milliseconds, when the runtime recorded one.
  timestamp: number | null;
  model?: string | null;
  finishReason?: string | null;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  preview: string | null;
  source: string | null;
  model: string | null;
  // Epoch milliseconds.
  startedAt: number | null;
  endedAt: number | null;
  lastActiveAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  usage: GenAiUsage;
  // What the runtime itself estimated the session cost, in US dollars.
  estimatedCostUsd: number | null;
  parentSessionId: string | null;
}

export interface SessionPage {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionSearchHit {
  sessionId: string;
  role: string | null;
  // The matching words are marked with >>> and <<<.
  snippet: string;
  session: SessionSummary | null;
}

export interface Transcript {
  session: SessionSummary;
  messages: TranscriptMessage[];
  // Index of the first message returned, and how many the session holds.
  offset: number;
  totalMessages: number;
  // A message or a part was cut to stay within the size Helena accepts.
  truncated: boolean;
}

export interface LogLines {
  lines: string[];
  truncated: boolean;
}

export interface RuntimeHealth {
  ok: boolean;
  // The runtime's own check, as it printed it, redacted.
  report: string;
  checkedAt: number;
}

export interface RuntimeVersion {
  runtime: string;
  version: string | null;
  // The runtime's own version line.
  detail: string | null;
}

export interface CuratorStatus {
  paused: boolean | null;
  report: string;
}

// The requests Helena sends. Each is answered with the result type named beside it.
export type RuntimeRequest =
  | { op: 'sessions.list'; limit?: number; offset?: number }
  | { op: 'sessions.search'; query: string; limit?: number }
  | { op: 'sessions.transcript'; sessionId: string; offset?: number; limit?: number }
  | { op: 'logs.read'; sessionId?: string | null; lines?: number; level?: string | null }
  | { op: 'health.check' }
  | { op: 'version.read' }
  | { op: 'curator.status' }
  | { op: 'curator.run' }
  | { op: 'curator.set'; action: 'pin' | 'unpin'; skill: string }
  | { op: 'estop.set'; engaged: boolean; reason?: string | null }
  // The runtime's own installation: check for, apply and follow an update (Hermes, through
  // its root helper's spool). Answered by the runner itself, not by a reader.
  | { op: 'runtime.update'; action: 'check' | 'apply' | 'status'; target?: string | null }
  // How much of the plan limits of the logins the agent's runtime uses is spent
  // (usage-limits.ts); answered with `{ snapshots: UsageLimitSnapshot[] }`. `force` skips
  // the runner's cache of the last probe (still at most one probe per login a minute).
  // `providers` is filled in by the runner for the profile helper of an isolated agent.
  | { op: 'limits.read'; force?: boolean; providers?: string[] }
  // The runtime's own login in the agent's home (runtime-account.ts), read now; answered
  // with `{ account: RuntimeAccount | null }`. Claude Code and Codex agents only.
  | { op: 'login.read' }
  // Signs that login out with the runtime's own command in the agent's sandbox; answered
  // with `{ account: RuntimeAccount | null }` as read afterwards.
  | { op: 'login.logout' };

export type RuntimeRequestOp = RuntimeRequest['op'];

// The capability Helena reads off the runtime status to know which requests an agent's
// runtime answers.
export const REQUEST_CAPABILITY: Record<RuntimeRequestOp, string> = {
  'sessions.list': 'sessions',
  'sessions.search': 'session-search',
  'sessions.transcript': 'transcripts',
  'logs.read': 'logs',
  'health.check': 'health',
  'version.read': 'version',
  'curator.status': 'curator',
  'curator.run': 'curator',
  'curator.set': 'curator',
  'estop.set': 'estop',
  'runtime.update': 'update',
  'limits.read': 'limits',
  'login.read': 'login',
  'login.logout': 'logout',
};

// Where an adapter reads: the agent's runtime home and working directory. For an isolated
// agent the same code runs in the profile helper as the project's user.
export interface ReaderContext {
  runtime: string;
  // HERMES_HOME for Hermes, the agent's home directory for Claude Code and Codex.
  home: string;
  cwd: string | null;
  env: Record<string, string>;
}

// The reading side of a runtime adapter. A runtime that cannot answer an op leaves it out of
// `ops`, and Helena shows the capability as missing.
export interface RuntimeReaders {
  readonly runtime: string;
  readonly ops: readonly RuntimeRequestOp[];
  handle(request: RuntimeRequest, context: ReaderContext): Promise<unknown>;
}
