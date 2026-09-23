import { t } from 'elysia';

import type { ThreadMatch } from './chat-history';

// Shared by every route in the domain that addresses an agent by its id. An agent
// belongs to a team, so that is where it is addressed.
export const agentParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric({ description: 'Agent id from list_ai_agents.' }),
});

// The same, for the routes that act on an agent inside one project of its team: a
// chat, and a run of an internal agent.
export const projectAgentParams = t.Object({
  projectKey: t.String(),
  agentId: t.Numeric({ description: 'Agent id from list_ai_agents.' }),
});

// What started a run, in the run history and in the queue a runner drains.
export const agentRunTrigger = t.Union([
  t.Literal('mention'),
  t.Literal('delegation'),
  t.Literal('field'),
  t.Literal('schedule'),
  t.Literal('manual'),
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
export const contextUsageBody = t.Optional(
  t.Nullable(
    t.Object({
      inputTokens: t.Integer({ minimum: 0 }),
      outputTokens: t.Integer({ minimum: 0 }),
    }),
  ),
);

// The transcript of a chat, shared by both kinds of agent: an internal agent's
// conversations are held by the runtime's memory, an external agent's by the feed its
// runner drains, and the routes serving them return these shapes either way.

// One chat thread in the history list. `cliSessionId` belongs to an external agent's
// threads, where a runner keeps the session; an internal agent runs here and has none.
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
    };

// One message of a conversation. Only user and assistant turns are returned; a tool
// turn is folded into the parts of the turn that called it. `stopped` marks an answer
// the member ended part-way.
export type ChatMessageDTO = {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  createdAt: string;
  stopped?: boolean;
};

export type ChatMessagePage = {
  items: ChatMessageDTO[];
  nextPage: number | null;
  // Present on the newest page while an external runner is still producing its
  // answer. A reloaded browser uses it to reconnect to that exact answer rather than
  // sending the member's prompt a second time.
  activeAnswer?: {
    messageId: number;
    status: 'pending' | 'streaming';
    createdAt: string;
  };
};

export type ChatThreadPage = {
  items: ChatThreadSummary[];
  nextPage: number | null;
};
