import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { cutText } from './hermes';
import { runCommand, stripAnsi } from './process';
import type {
  GenAiUsage,
  ReaderContext,
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

// Claude Code and Codex keep each session as a JSONL file in the agent's home. The runner
// reads those files for the agent's own working directory only: agents of other projects
// that share the home keep their sessions to themselves.
//   Claude Code: <home>/.claude/projects/<cwd, every other character than [A-Za-z0-9] as '-'>/<session>.jsonl
//   Codex:       <home>/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session>.jsonl

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SESSIONS = 500;
const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;

type Json = Record<string, unknown>;

const zero = (): GenAiUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
});

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const time = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

async function* lines(path: string): AsyncGenerator<Json> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return;
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }) });
  for await (const line of reader) {
    if (!line.startsWith('{')) continue;
    try {
      yield JSON.parse(line) as Json;
    } catch {
      // A line cut by a crash is skipped.
    }
  }
}

async function entries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

interface Parsed {
  summary: SessionSummary;
  messages: TranscriptMessage[];
  truncated: boolean;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// ---------------------------------------------------------------- Claude Code

export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function claudeRoot(context: ReaderContext): string {
  return context.env.CLAUDE_CONFIG_DIR ?? join(context.home, '.claude');
}

// The project folders of the agent's working directory and of the folders below it, where
// runs of an area start.
async function claudeFiles(context: ReaderContext): Promise<string[]> {
  if (!context.cwd) return [];
  const root = join(claudeRoot(context), 'projects');
  const prefix = claudeProjectDir(context.cwd);
  const files: string[] = [];
  for (const dir of await entries(root)) {
    if (dir !== prefix && !dir.startsWith(`${prefix}-`)) continue;
    for (const name of await entries(join(root, dir))) {
      if (name.endsWith('.jsonl')) files.push(join(root, dir, name));
    }
  }
  return files;
}

function claudeBlocks(content: unknown): Json[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Json[]) : [];
}

export async function parseClaudeSession(path: string): Promise<Parsed> {
  const id = basename(path, '.jsonl');
  const messages: TranscriptMessage[] = [];
  const usage = zero();
  let truncated = false;
  let model: string | null = null;
  let title: string | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let toolCalls = 0;
  const text = (value: string) => {
    const result = cutText(value);
    truncated ||= result.cut;
    return result.text;
  };
  for await (const line of lines(path)) {
    if (line.type === 'summary') {
      title ??= str(line.summary);
      continue;
    }
    if (line.type !== 'user' && line.type !== 'assistant') continue;
    const message = (line.message ?? {}) as Json;
    const at = time(line.timestamp);
    first ??= at;
    last = at ?? last;
    const parts: TranscriptPart[] = [];
    let role: TranscriptMessage['role'] = line.type === 'assistant' ? 'assistant' : 'user';
    for (const block of claudeBlocks(message.content)) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push({ type: 'text', content: text(block.text) });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        parts.push({ type: 'reasoning', content: text(block.thinking) });
      } else if (block.type === 'tool_use') {
        toolCalls++;
        parts.push({
          type: 'tool_call',
          id: str(block.id),
          name: str(block.name) ?? 'tool',
          arguments: block.input ?? null,
        });
      } else if (block.type === 'tool_result') {
        role = 'tool';
        const content = claudeBlocks(block.content)
          .map((item) => (typeof item.text === 'string' ? item.text : ''))
          .join('\n');
        parts.push({
          type: 'tool_call_response',
          id: str(block.tool_use_id),
          name: null,
          response: text(content),
          ...(block.is_error === true && { isError: true }),
        });
      }
    }
    if (line.type === 'assistant') {
      model = str(message.model) ?? model;
      const counted = (message.usage ?? {}) as Json;
      const cacheRead = num(counted.cache_read_input_tokens);
      const cacheWrite = num(counted.cache_creation_input_tokens);
      usage.inputTokens += num(counted.input_tokens) + cacheRead + cacheWrite;
      usage.cacheReadTokens += cacheRead;
      usage.cacheWriteTokens += cacheWrite;
      usage.outputTokens += num(counted.output_tokens);
    }
    if (role === 'user' && !title) {
      const firstText = parts.find((part) => part.type === 'text');
      if (firstText?.type === 'text') title = firstText.content.slice(0, 80);
    }
    if (parts.length === 0) continue;
    messages.push({
      id: str(line.uuid) ?? String(messages.length + 1),
      role,
      parts,
      timestamp: at,
      model: line.type === 'assistant' ? str(message.model) : null,
      finishReason: str(message.stop_reason),
    });
  }
  return {
    summary: {
      id,
      title,
      preview: title,
      source: 'claude',
      model,
      startedAt: first,
      endedAt: last,
      lastActiveAt: last,
      endReason: null,
      messageCount: messages.length,
      toolCallCount: toolCalls,
      usage,
      estimatedCostUsd: null,
      parentSessionId: null,
    },
    messages,
    truncated,
  };
}

// ---------------------------------------------------------------- Codex

function codexRoot(context: ReaderContext): string {
  return context.env.CODEX_HOME ?? join(context.home, '.codex');
}

async function codexFiles(context: ReaderContext): Promise<string[]> {
  const root = join(codexRoot(context), 'sessions');
  const files: string[] = [];
  for (const year of (await entries(root)).sort().reverse()) {
    for (const month of (await entries(join(root, year))).sort().reverse()) {
      for (const day of (await entries(join(root, year, month))).sort().reverse()) {
        for (const name of await entries(join(root, year, month, day))) {
          if (name.startsWith('rollout-') && name.endsWith('.jsonl'))
            files.push(join(root, year, month, day, name));
        }
        if (files.length >= MAX_SESSIONS) return files;
      }
    }
  }
  return files;
}

function codexText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return (content as Json[])
    .map((item) => (typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n');
}

// Null for a session of another working directory.
export async function parseCodexSession(path: string, cwd: string | null): Promise<Parsed | null> {
  const messages: TranscriptMessage[] = [];
  let usage = zero();
  let truncated = false;
  let id: string | null = null;
  let model: string | null = null;
  let title: string | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let toolCalls = 0;
  const text = (value: string) => {
    const result = cutText(value);
    truncated ||= result.cut;
    return result.text;
  };
  for await (const line of lines(path)) {
    const payload = (line.payload ?? {}) as Json;
    const at = time(line.timestamp);
    first ??= at;
    last = at ?? last;
    if (line.type === 'session_meta') {
      id = str(payload.id);
      const sessionCwd = str(payload.cwd);
      if (cwd && sessionCwd && sessionCwd !== cwd && !sessionCwd.startsWith(`${cwd}/`)) return null;
      continue;
    }
    if (line.type === 'turn_context') {
      model = str(payload.model) ?? model;
      continue;
    }
    if (line.type === 'event_msg' && payload.type === 'token_count') {
      const total = ((payload.info as Json | null)?.total_token_usage ?? {}) as Json;
      usage = {
        inputTokens: num(total.input_tokens),
        outputTokens: num(total.output_tokens),
        cacheReadTokens: num(total.cached_input_tokens),
        cacheWriteTokens: 0,
        reasoningTokens: num(total.reasoning_output_tokens),
      };
      continue;
    }
    if (line.type !== 'response_item') continue;
    const index = String(messages.length + 1);
    if (payload.type === 'message') {
      const role =
        payload.role === 'assistant' ? 'assistant' : payload.role === 'user' ? 'user' : null;
      const body = codexText(payload.content);
      // Codex puts its environment and instructions into user messages in tags.
      if (!role || !body.trim() || (role === 'user' && /^\s*<[a-z_]+>/i.test(body))) continue;
      if (role === 'user') title ??= body.slice(0, 80);
      messages.push({
        id: index,
        role,
        parts: [{ type: 'text', content: text(body) }],
        timestamp: at,
      });
    } else if (payload.type === 'reasoning') {
      const summary = codexText(payload.summary);
      if (summary.trim())
        messages.push({
          id: index,
          role: 'assistant',
          parts: [{ type: 'reasoning', content: text(summary) }],
          timestamp: at,
        });
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      toolCalls++;
      const raw = payload.arguments ?? payload.input;
      let args: unknown = raw ?? null;
      if (typeof raw === 'string') {
        try {
          args = JSON.parse(raw) as unknown;
        } catch {
          args = text(raw);
        }
      }
      messages.push({
        id: index,
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            id: str(payload.call_id),
            name: str(payload.name) ?? 'tool',
            arguments: args,
          },
        ],
        timestamp: at,
      });
    } else if (
      payload.type === 'function_call_output' ||
      payload.type === 'custom_tool_call_output'
    ) {
      const output = payload.output;
      const content =
        typeof output === 'string'
          ? output
          : typeof (output as Json | null)?.content === 'string'
            ? ((output as Json).content as string)
            : JSON.stringify(output ?? null);
      messages.push({
        id: index,
        role: 'tool',
        parts: [
          {
            type: 'tool_call_response',
            id: str(payload.call_id),
            name: null,
            response: text(content),
          },
        ],
        timestamp: at,
      });
    }
  }
  const sessionId = id ?? /([0-9a-f-]{36})\.jsonl$/.exec(path)?.[1] ?? basename(path, '.jsonl');
  return {
    summary: {
      id: sessionId,
      title,
      preview: title,
      source: 'codex',
      model,
      startedAt: first,
      endedAt: last,
      lastActiveAt: last,
      endReason: null,
      messageCount: messages.length,
      toolCallCount: toolCalls,
      usage,
      estimatedCostUsd: null,
      parentSessionId: null,
    },
    messages,
    truncated,
  };
}

// ---------------------------------------------------------------- shared

interface JsonlStore {
  runtime: 'claude' | 'codex';
  bin: string;
  files(context: ReaderContext): Promise<string[]>;
  parse(path: string, context: ReaderContext): Promise<Parsed | null>;
}

async function sessions(store: JsonlStore, context: ReaderContext): Promise<Parsed[]> {
  const parsed: Parsed[] = [];
  for (const file of (await store.files(context)).slice(0, MAX_SESSIONS)) {
    const session = await store.parse(file, context).catch(() => null);
    if (session && session.messages.length > 0) parsed.push(session);
  }
  return parsed.sort((a, b) => (b.summary.lastActiveAt ?? 0) - (a.summary.lastActiveAt ?? 0));
}

function marked(text: string, query: string): string | null {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - 80);
  return `${text.slice(start, at)}>>>${text.slice(at, at + query.length)}<<<${text.slice(
    at + query.length,
    at + query.length + 160,
  )}`;
}

function readers(store: JsonlStore): RuntimeReaders {
  return {
    runtime: store.runtime,
    ops: ['sessions.list', 'sessions.search', 'sessions.transcript', 'version.read'],
    async handle(request: RuntimeRequest, context: ReaderContext) {
      switch (request.op) {
        case 'sessions.list': {
          const all = await sessions(store, context);
          const offset = Math.max(0, request.offset ?? 0);
          const limit = Math.min(Math.max(1, request.limit ?? 25), 100);
          return {
            sessions: all.slice(offset, offset + limit).map((session) => session.summary),
            total: all.length,
          } satisfies SessionPage;
        }
        case 'sessions.search': {
          const query = request.query.trim();
          const hits: SessionSearchHit[] = [];
          if (!query) return hits;
          for (const session of await sessions(store, context)) {
            for (const message of session.messages) {
              const snippet = message.parts
                .map((part) =>
                  part.type === 'text' || part.type === 'reasoning'
                    ? marked(part.content, query)
                    : null,
                )
                .find(Boolean);
              if (!snippet) continue;
              hits.push({
                sessionId: session.summary.id,
                role: message.role,
                snippet,
                session: session.summary,
              });
              break;
            }
            if (hits.length >= Math.min(request.limit ?? 20, 50)) break;
          }
          return hits;
        }
        case 'sessions.transcript': {
          if (!SESSION_ID.test(request.sessionId)) throw new Error('The session id is invalid');
          const session = (await sessions(store, context)).find(
            (entry) => entry.summary.id === request.sessionId,
          );
          if (!session) throw new Error('Session not found');
          const offset = Math.max(0, request.offset ?? 0);
          const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_PAGE), MAX_PAGE);
          return {
            session: session.summary,
            messages: session.messages.slice(offset, offset + limit),
            offset,
            totalMessages: session.messages.length,
            truncated: session.truncated,
          } satisfies Transcript;
        }
        case 'version.read': {
          const result = await runCommand(
            context.env[`${store.runtime.toUpperCase()}_BIN`] ?? store.bin,
            ['--version'],
            {
              env: { ...(process.env as Record<string, string>), ...context.env },
              timeoutMs: 15_000,
              maxBytes: 64 * 1024,
            },
          );
          const detail = stripAnsi(result.stdout).trim().split('\n')[0] || null;
          return {
            runtime: store.runtime,
            version: /(\d+\.\d+\.\d+[^\s)]*)/.exec(detail ?? '')?.[1] ?? null,
            detail,
          } satisfies RuntimeVersion;
        }
        default:
          throw new Error(`${store.runtime} cannot answer ${request.op}`);
      }
    },
  };
}

export const claudeReaders = readers({
  runtime: 'claude',
  bin: 'claude',
  files: claudeFiles,
  parse: (path) => parseClaudeSession(path),
});

export const codexReaders = readers({
  runtime: 'codex',
  bin: 'codex',
  files: codexFiles,
  parse: (path, context) => parseCodexSession(path, context.cwd),
});
