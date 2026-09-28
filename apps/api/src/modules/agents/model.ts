import { t } from 'elysia';

import type { ThreadMatch } from './chat-history';
import type { ChatAttachment } from './chat/attachments';

// Shared by every route in the domain that addresses an agent by its id. An agent
// belongs to a team, so that is where it is addressed.
export const agentParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric({ description: 'Agent id from list_ai_agents.' }),
});

// The same, for the routes that act on an agent inside one project of its team, such as
// a chat.
export const projectAgentParams = t.Object({
  projectKey: t.String(),
  agentId: t.Numeric({ description: 'Agent id from list_ai_agents.' }),
});

// What started a run, in the run history and in the queue a runner drains.
export const agentRunTrigger = t.Union([
  t.Literal('mention'),
  t.Literal('delegation'),
  t.Literal('subtask'),
  t.Literal('field'),
  t.Literal('schedule'),
  t.Literal('heartbeat'),
  t.Literal('manual'),
  t.Literal('approval'),
  // A job for the runner itself (a repository clone), whose prompt is the job as JSON.
  t.Literal('workspace'),
  // A text-only run (the update center's summary of release notes): the prompt goes to the
  // model as it is, with no tools, rules or memory.
  t.Literal('digest'),
]);

export type AgentRunTrigger = typeof agentRunTrigger.static;

// The limits a run hands to Hermes: tool-calling iterations (`--max-turns`) and
// wall-clock seconds (`--run-budget`).
export const maxTurnsLimit = { minimum: 1, maximum: 200 };
export const runBudgetSecondsLimit = { minimum: 60, maximum: 7_200 };

// The token counts of one run, in the agent's run history and in a schedule's. Shared
// by both listings, which return the same runs under different filters.
export const runContextTokens = t.Optional(
  t.Number({
    description:
      'The tokens this run read and wrote: the totals of the run where its agent reports ' +
      'them (Hermes), otherwise its last model call. Absent for a run that finished before ' +
      'this was recorded and for one whose agent reports no counts.',
  }),
);

// What an answer or a run read, cache included, and what it wrote, as a runner reports
// it: for a chat answer its last model call, for a run the totals of the run where the
// command reports them (Hermes), otherwise its last model call. Left out by a command
// that reported nothing about it, which leaves the counts already stored; null where the
// command reports none. Shared by the chat result and the run result.
// What a run, chat answer or reflection spent in total, for the token ledger: every model
// call summed, with the model that ran. OpenTelemetry GenAI counts: input includes the cached
// reads and writes, output includes reasoning.
export const spendBody = t.Optional(
  t.Nullable(
    t.Object({
      runtime: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
      model: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      provider: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
      inputTokens: t.Integer({ minimum: 0 }),
      outputTokens: t.Integer({ minimum: 0 }),
      cacheReadTokens: t.Optional(t.Integer({ minimum: 0 })),
      cacheWriteTokens: t.Optional(t.Integer({ minimum: 0 })),
      reasoningTokens: t.Optional(t.Integer({ minimum: 0 })),
      durationMs: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
    }),
  ),
);

export const contextUsageBody = t.Optional(
  t.Nullable(
    t.Object({
      inputTokens: t.Integer({ minimum: 0 }),
      outputTokens: t.Integer({ minimum: 0 }),
    }),
  ),
);

// The transcript of a chat: the conversations are held by the feed the agent's runner
// drains, and the routes serving them return these shapes.

// One chat thread in the history list. `cliSessionId` is the session the agent's runner
// keeps for the thread, null until it reports one.
// `contextTokens` is the size of the conversation's context after its last completed
// answer: absent while no answer has completed, null where the agent reports no counts
// that can be read as one.
// `favorite` is the star the caller put on the conversation. `snippet` and `match` are
// set by a search: the text around the hit, and where it was found.
export type ChatThreadSummary = {
  id: string;
  title: string | null;
  cliSessionId: string | null;
  model: string | null;
  thinkingLevel: string | null;
  contextTokens?: number | null;
  favorite: boolean;
  snippet?: string;
  match?: ThreadMatch;
  createdAt: string;
  updatedAt: string;
};

// One piece of a message, in the order the agent produced it: what it wrote, and the
// tools it called between one stretch of text and the next. A call carries what it was
// given and what it answered where those are known — an agent that reports neither
// leaves both unset.
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      toolCallId: string;
      toolName: string;
      args?: string;
      result?: string;
      isError?: boolean;
    };

// One message of a conversation. Only user and assistant turns are returned; a tool
// turn is folded into the parts of the turn that called it. `stopped` marks an answer
// the member ended part-way.
//
// An external agent's messages also carry their place in the tree of versions
// (`parentId`, and `siblingIds` with the message itself among them), the agent that
// answered, the files and tasks of a question, and the model, tokens and duration of an
// answer. `error` is why an answer failed.
export type ChatMessageDTO = {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  createdAt: string;
  stopped?: boolean;
  parentId?: string | null;
  siblingIds?: string[];
  agentId?: number;
  attachments?: ChatAttachment[];
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  error?: string;
  // Why it failed, where the runtime's words said: the chat words it in the reader's
  // language (a model the provider refused this account).
  errorCode?: string;
  errorModel?: string | null;
  // A local model was asked for and the configured one answered (the model check's fallback).
  localFallback?: { from: string; reason: 'off' | 'down' | 'failed' };
  // A question said in the conversation mode, or an answer Helena's voice reply gave.
  via?: 'voice';
  // What the model router did for an answer (decisions.md §4).
  modelRoute?: {
    fromModel: string;
    toModel: string;
    routed: boolean;
    tier: string | null;
    confidence: number | null;
    needsContext: number | null;
    reason: string;
  } | null;
};

export type ChatMessagePage = {
  items: ChatMessageDTO[];
  nextPage: number | null;
  // Present on the newest page while an external runner is still producing its
  // answer. A reloaded browser uses it to reconnect to that exact answer rather than
  // sending the member's prompt a second time.
  activeAnswer?: {
    messageId: number;
    // The agent producing it, which is the one its stream is read from.
    agentId?: number;
    status: 'pending' | 'streaming';
    createdAt: string;
  };
};

export type ChatThreadPage = {
  items: ChatThreadSummary[];
  nextPage: number | null;
};
