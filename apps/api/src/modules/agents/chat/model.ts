import { t } from 'elysia';

import { pageQueryFields, pageResponse } from '#shared/pagination';
import { contextUsageBody } from '../model';

export { agentParams, projectAgentParams } from '../model';

// A chat with an external agent is carried by AG-UI events (https://docs.ag-ui.com):
// the runner reports what its coding agent produces as this event stream, and the
// browser is served the same events. The schemas below are the subset the chat needs,
// with the field names the protocol defines, so a runner that already speaks AG-UI
// needs no translation. Lifecycle ids are optional here because the server knows the
// thread and the answer they belong to; everything else is required as specified.

// The longest text delta accepted in one event. A runner buffers its output rather
// than sending a request per token, and this bounds how much one event may carry.
const DELTA_LIMIT = 12_000;

// The longest arguments or result accepted for one tool call. A runner reports each of
// them whole, and cutting one breaks the JSON the chat indents and highlights.
const TOOL_TEXT_LIMIT = 32_000;

// A browser dictation result and typed text take the same path. Bound the complete
// message at the API boundary so neither can create an unbounded database row or CLI
// stdin payload. Attachment markers are included in this budget.
export const CHAT_PROMPT_LIMIT = 32_000;

const RunStartedEvent = t.Object({
  type: t.Literal('RUN_STARTED'),
  threadId: t.Optional(t.String()),
  runId: t.Optional(t.String()),
});

const RunFinishedEvent = t.Object({
  type: t.Literal('RUN_FINISHED'),
  threadId: t.Optional(t.String()),
  runId: t.Optional(t.String()),
});

const RunErrorEvent = t.Object({
  type: t.Literal('RUN_ERROR'),
  message: t.String({ maxLength: 2000 }),
  code: t.Optional(t.String({ maxLength: 200 })),
});

const TextMessageStartEvent = t.Object({
  type: t.Literal('TEXT_MESSAGE_START'),
  messageId: t.String({ maxLength: 200 }),
  role: t.Literal('assistant'),
});

const TextMessageContentEvent = t.Object({
  type: t.Literal('TEXT_MESSAGE_CONTENT'),
  messageId: t.String({ maxLength: 200 }),
  delta: t.String({ maxLength: DELTA_LIMIT }),
});

const TextMessageEndEvent = t.Object({
  type: t.Literal('TEXT_MESSAGE_END'),
  messageId: t.String({ maxLength: 200 }),
});

// The model's reasoning while it answers, kept apart from the answer text.
const ThinkingTextMessageContentEvent = t.Object({
  type: t.Literal('THINKING_TEXT_MESSAGE_CONTENT'),
  delta: t.String({ maxLength: DELTA_LIMIT }),
});

const ToolCallStartEvent = t.Object({
  type: t.Literal('TOOL_CALL_START'),
  toolCallId: t.String({ maxLength: 200 }),
  toolCallName: t.String({ maxLength: 200 }),
  parentMessageId: t.Optional(t.String({ maxLength: 200 })),
});

const ToolCallArgsEvent = t.Object({
  type: t.Literal('TOOL_CALL_ARGS'),
  toolCallId: t.String({ maxLength: 200 }),
  delta: t.String({ maxLength: TOOL_TEXT_LIMIT }),
});

const ToolCallEndEvent = t.Object({
  type: t.Literal('TOOL_CALL_END'),
  toolCallId: t.String({ maxLength: 200 }),
});

const ToolCallResultEvent = t.Object({
  type: t.Literal('TOOL_CALL_RESULT'),
  messageId: t.String({ maxLength: 200 }),
  toolCallId: t.String({ maxLength: 200 }),
  content: t.String({ maxLength: TOOL_TEXT_LIMIT }),
  role: t.Optional(t.Literal('tool')),
  // Not part of AG-UI: the tool reported a failure, and `content` is its error.
  isError: t.Optional(t.Boolean()),
});

export const AgUiEvent = t.Union([
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ThinkingTextMessageContentEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
]);

export type AgUiEventBody = typeof AgUiEvent.static;

export const chatMessageParams = t.Object({
  projectKey: t.String(),
  agentId: t.Numeric(),
  messageId: t.Numeric(),
});

export const teamChatMessageParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  messageId: t.Numeric(),
});

export const runnerMessageParams = t.Object({ messageId: t.Numeric() });

const chatModel = t.Object({
  id: t.String({ minLength: 1, maxLength: 200 }),
  name: t.String({ minLength: 1, maxLength: 200 }),
  reasoning: t.Boolean(),
  thinkingLevels: t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 }),
  thinkingDefault: t.Nullable(t.String({ maxLength: 40 })),
  // The provider that serves the model when the runner lists more than one.
  provider: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
});

export const chatCatalogBody = t.Object({ models: t.Array(chatModel, { maxItems: 200 }) });

export const ChatCatalogResponse = t.Object({
  models: t.Array(chatModel),
  updatedAt: t.Nullable(t.String()),
});

export const sendChatBody = t.Object({
  prompt: t.String({
    minLength: 1,
    maxLength: CHAT_PROMPT_LIMIT,
    description: 'Message to send the agent.',
  }),
  threadId: t.Optional(
    t.String({ description: 'Thread id of an earlier message, to continue that conversation.' }),
  ),
  model: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 200 }))),
  thinkingLevel: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 40 }))),
  parentId: t.Optional(
    t.Nullable(
      t.Numeric({
        description:
          'The message of the thread this one follows. Omitted, the message the thread shows ' +
          'last; null, a new first message — which is how an edited first question is sent.',
      }),
    ),
  ),
  attachments: t.Optional(
    t.Object({
      files: t.Optional(
        t.Array(t.String({ minLength: 1, maxLength: 1024 }), {
          maxItems: 10,
          description:
            'Vault paths of files for the agent to read: Home/…, Templates/… or Projects/<KEY>/….',
        }),
      ),
      issueIds: t.Optional(
        t.Array(t.Integer(), { maxItems: 10, description: 'Tasks the message refers to.' }),
      ),
    }),
  ),
});

// Answers a question of the thread again, next to the answers it has.
export const retryChatBody = t.Object({
  threadId: t.String(),
  questionId: t.Numeric({ description: 'The question to answer again.' }),
});

// What the caller needs to follow the answer: the thread it belongs to and the id of
// the answer being produced, and the id the question was stored under.
export const SendChatResponse = t.Object({
  threadId: t.String(),
  messageId: t.Number(),
  userMessageId: t.Number(),
});

export const RetryChatResponse = t.Object({
  threadId: t.String(),
  messageId: t.Number(),
});

// Events are read with a cursor: `after` is the id of the last event already seen.
export const chatEventsQuery = t.Object({ after: t.Optional(t.Numeric({ minimum: 0 })) });

// Where an answer stands: queued, being produced by a runner, or closed — finished,
// failed, or stopped from the chat.
export const chatMessageStatus = t.Union([
  t.Literal('pending'),
  t.Literal('streaming'),
  t.Literal('success'),
  t.Literal('failed'),
  t.Literal('canceled'),
]);

export type ChatMessageStatus = typeof chatMessageStatus.static;

export const ChatEventsResponse = t.Object({
  items: t.Array(t.Object({ id: t.Number(), event: AgUiEvent })),
  status: chatMessageStatus,
  error: t.Nullable(t.String()),
  nextCursor: t.Nullable(t.Number()),
  hasMore: t.Boolean(),
});

// The claimed answer, or null when the agent has nothing waiting. `prompt` carries the
// conversation so far, framed the same way a run's task is — except when `sessionId` is
// set, where the runner's session already holds it and only the new message is sent.
export const ClaimChatResponse = t.Object({
  message: t.Nullable(
    t.Object({
      id: t.Number(),
      threadId: t.String(),
      prompt: t.String(),
      systemPrompt: t.String(),
      attempts: t.Number(),
      sessionId: t.Nullable(
        t.String({
          description:
            "The coding agent session this thread is bound to on the runner's machine. " +
            'Null when there is none yet: start a fresh one and report the id it got.',
        }),
      ),
      model: t.Nullable(t.String()),
      thinkingLevel: t.Nullable(t.String()),
      images: t.Array(t.String(), {
        description:
          'Absolute paths of the images attached to the question, for a model that reads images.',
      }),
    }),
  ),
});

export const chatEventsBody = t.Object({
  events: t.Array(AgUiEvent, { minItems: 1, maxItems: 200 }),
  sessionId: t.Optional(
    t.String({
      maxLength: 200,
      description:
        'The session the runner started for this thread, reported once so later messages ' +
        'in it resume that session instead of being sent the conversation again.',
    }),
  ),
});

// `usage` is the size of the context this answer left behind. A null one is shown as a
// dash in the chat.
export const chatResultBody = t.Object({
  status: t.Union([t.Literal('success'), t.Literal('failed')]),
  error: t.Optional(t.Nullable(t.String())),
  usage: contextUsageBody,
  sessionLost: t.Optional(
    t.Boolean({
      description:
        'The resumed session no longer exists. The thread is unbound and the answer is ' +
        'queued again with the conversation in its prompt.',
    }),
  ),
  model: t.Optional(
    t.String({ maxLength: 200, description: 'The model the answer was produced with.' }),
  ),
});

// The answer of every runner call that reports progress. `canceled` is how the stop
// reaches the runner: it is returned on the calls the runner already makes, so the
// server needs no connection to the operator's machine.
export const ChatAckResponse = t.Object({
  canceled: t.Boolean({
    description: 'The answer was stopped from the chat: kill the command and stop reporting.',
  }),
});

// The caller's chats across the agents: Home reads all of them, a project its own.
export const chatListQuery = t.Object({
  projectKey: t.Optional(t.String({ description: 'Only the chats of this project.' })),
  agentId: t.Optional(t.Numeric({ description: 'Only the chats with this agent.' })),
  q: t.Optional(
    t.String({
      maxLength: 200,
      description:
        'Case-insensitive substring, matched against the title and the text of every message. ' +
        'Shorter than two characters searches nothing.',
    }),
  ),
  view: t.Optional(
    t.UnionEnum(['active', 'archived', 'trash'], {
      description: 'The listed chats, the archived ones, or the deleted ones. Default active.',
    }),
  ),
  ...pageQueryFields,
});

export const ChatSummaryResponse = t.Object({
  id: t.String(),
  title: t.Nullable(t.String()),
  agent: t.Object({ id: t.Number(), name: t.String(), username: t.String() }),
  teamId: t.Number(),
  project: t.Nullable(t.Object({ id: t.Number(), key: t.String(), name: t.String() })),
  issue: t.Nullable(t.Object({ id: t.Number(), identifier: t.String(), title: t.String() })),
  pinned: t.Boolean(),
  running: t.Boolean({ description: 'An answer is being produced.' }),
  archivedAt: t.Nullable(t.String()),
  deletedAt: t.Nullable(t.String()),
  snippet: t.Optional(t.String()),
  match: t.Optional(t.UnionEnum(['title', 'user', 'assistant'])),
  createdAt: t.String(),
  updatedAt: t.String(),
  contextTokens: t.Optional(
    t.Nullable(
      t.Number({
        description:
          'The tokens the chat’s last completed answer read and wrote, which is the size of ' +
          'its context. Absent while no answer has completed; null where the agent reports ' +
          'no counts that can be read as a context size.',
      }),
    ),
  ),
});

export const ChatListResponse = pageResponse(ChatSummaryResponse);

export const chatParams = t.Object({ threadId: t.String() });

export const updateChatBody = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
  archived: t.Optional(t.Boolean()),
  issueId: t.Optional(t.Nullable(t.Integer({ description: 'The task to link, or null.' }))),
});

export const deleteChatQuery = t.Object({
  permanent: t.Optional(
    t.Boolean({ description: 'Delete a chat in the trash for good, with its messages.' }),
  ),
});

export const showVersionBody = t.Object({
  messageId: t.Integer({ description: 'The version to show: a message of the chat.' }),
});

export const issueChatParams = t.Object({ issueId: t.Numeric() });
