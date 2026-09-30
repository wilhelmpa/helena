import { MessageInjectedEvent } from '../native-runtime/model';
import { t } from 'elysia';
import { runFailure, unavailableCatalogModel } from '#modules/model-availability/model';
import { pageQueryFields, pageResponse } from '#shared/pagination';
import { contextUsageBody, spendBody } from '../model';
import { runModelReport } from '../runtime-sync/model';
import { oneOf } from '#shared/schemas';

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
  // The AG-UI version the runner speaks (AG-UI 1.0 names it on RUN_STARTED).
  protocolVersion: t.Optional(t.String({ maxLength: 40 })),
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

// The model's reasoning while it answers, kept apart from the answer text: AG-UI 1.0's
// REASONING_* events. THINKING_TEXT_MESSAGE_CONTENT is the name before 1.0, still
// accepted from runners that predate it (for one release).
const ThinkingTextMessageContentEvent = t.Object({
  type: t.Literal('THINKING_TEXT_MESSAGE_CONTENT'),
  delta: t.String({ maxLength: DELTA_LIMIT }),
});

const ReasoningStartEvent = t.Object({
  type: t.Literal('REASONING_START'),
  messageId: t.Optional(t.String({ maxLength: 200 })),
});

const ReasoningMessageStartEvent = t.Object({
  type: t.Literal('REASONING_MESSAGE_START'),
  messageId: t.String({ maxLength: 200 }),
  role: t.Optional(t.Literal('reasoning')),
});

const ReasoningMessageContentEvent = t.Object({
  type: t.Literal('REASONING_MESSAGE_CONTENT'),
  messageId: t.String({ maxLength: 200 }),
  delta: t.String({ maxLength: DELTA_LIMIT }),
});

const ReasoningMessageEndEvent = t.Object({
  type: t.Literal('REASONING_MESSAGE_END'),
  messageId: t.String({ maxLength: 200 }),
});

const ReasoningEndEvent = t.Object({
  type: t.Literal('REASONING_END'),
  messageId: t.Optional(t.String({ maxLength: 200 })),
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
  // AG-UI has no error flag on a result, so a failed tool says so in the event's
  // metadata, with MCP's name for it: `{ isError: true }`, `content` being the error.
  metadata: t.Optional(
    t.Object({
      isError: t.Optional(t.Boolean()),
      outcome: t.Optional(
        t.Union([t.Literal('ok'), t.Literal('nonzero_with_output'), t.Literal('error')]),
      ),
      exitCode: t.Optional(t.Union([t.Integer(), t.Null()])),
    }),
  ),
  // The same flag as runners before AG-UI 1.0 sent it (accepted for one release).
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
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
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
  listed: t.Optional(
    t.Boolean({
      description:
        "Whether the account's own model list names it; false for a model the runtime only " +
        'expects to work (Hermes adds newer models it has not seen listed).',
    }),
  ),
  variantOf: t.Optional(
    t.String({
      maxLength: 200,
      description: 'The model this one is a variant of (a larger context window of it).',
    }),
  ),
});

export const chatCatalogBody = t.Object({ models: t.Array(chatModel, { maxItems: 200 }) });

export const ChatCatalogResponse = t.Object({
  localModels: t.Optional(t.Array(chatModel)),
  models: t.Array(
    t.Composite([
      chatModel,
      t.Object({
        verified: t.Optional(
          t.Boolean({
            description:
              'Confirmed: listed by the account or seen working (true), or only expected to ' +
              'work (false). Unset when nothing tells.',
          }),
        ),
        local: t.Optional(
          t.Boolean({
            description:
              "A model of {appName}'s local AI (`helena-<slug>/<id>`): runs on the owner's own " +
              'machine and costs nothing per token.',
          }),
        ),
      }),
    ]),
  ),
  unavailable: t.Array(unavailableCatalogModel, {
    description:
      'Models the provider refused for this account: left out of `models` until a use of ' +
      'them succeeds or the owner lets them be tried again.',
  }),
  updatedAt: t.Nullable(t.String()),
});

export const sendChatBody = t.Object({
  prompt: t.String({
    minLength: 1,
    maxLength: CHAT_PROMPT_LIMIT,
    description: 'Message to send the agent.',
  }),
  context: t.Optional(
    t.Object({
      projectKey: t.Nullable(t.String({ minLength: 1, maxLength: 64 })),
      path: t.String({ minLength: 1, maxLength: 600 }),
    }),
  ),
  threadId: t.Optional(
    t.String({ description: 'Thread id of an earlier message, to continue that conversation.' }),
  ),
  model: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 200 }))),
  thinkingLevel: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 40 }))),
  via: t.Optional(
    t.Literal('voice', {
      description:
        'Said in the conversation mode: the answer is read aloud, so the agent is asked to ' +
        'answer short and speakable (and {appName}’s voice reply may answer it, where switched on).',
    }),
  ),
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
      refs: t.Optional(
        t.Array(t.String({ minLength: 3, maxLength: 1100 }), {
          maxItems: 10,
          description: 'Canonical knowledge references, such as vault:Home/Docs/x.md or mail:12.',
        }),
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
  items: t.Array(t.Object({ id: t.Number(), event: t.Union([AgUiEvent, MessageInjectedEvent]) })),
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
      projectId: t.Nullable(t.Number()),
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
      autopilotLevel: t.Integer({
        minimum: 0,
        maximum: 3,
        description:
          "The Autopilot level of the chat's project (the agent's own level for a Home chat); " +
          "a runner maps it onto its runtime's permission mode.",
      }),
    }),
  ),
});

export const chatEventsBody = t.Object({
  events: t.Array(AgUiEvent, { minItems: 1, maxItems: 200 }),
  delivery: t.Optional(
    t.Object({ claim: t.Integer({ minimum: 1 }), offset: t.Integer({ minimum: 0 }) }),
  ),
  sessionId: t.Optional(
    t.String({
      maxLength: 200,
      description:
        'The session the runner started for this thread, reported once so later messages ' +
        'in it resume that session instead of being sent the conversation again.',
    }),
  ),
});

export const chatClaimQuery = t.Object({ claim: t.Optional(t.Numeric({ minimum: 1 })) });

// `usage` is the size of the context this answer left behind. A null one is shown as a
// dash in the chat.
export const chatResultBody = t.Object({
  escalation: t.Optional(
    t.Object({
      target: t.String({ maxLength: 200 }),
      reason: t.String({ maxLength: 40 }),
      detail: t.Nullable(t.String({ maxLength: 200 })),
      handover: t.String({ maxLength: 20_000 }),
    }),
  ),
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
  spend: spendBody,
  runtime: t.Optional(runModelReport),
  failure: t.Optional(runFailure),
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
    oneOf(['active', 'archived', 'trash'], {
      description: 'The listed chats, the archived ones, or the deleted ones. Default active.',
    }),
  ),
  ...pageQueryFields,
});

export const jevFirstStageMode = oneOf(['inherit', 'on', 'off']);

export const ChatSummaryResponse = t.Object({
  jevFirstStage: jevFirstStageMode,
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
  purgeAt: t.Nullable(t.String()),
  snippet: t.Optional(t.String()),
  match: t.Optional(oneOf(['title', 'user', 'assistant'])),
  createdAt: t.String(),
  updatedAt: t.String(),
  model: t.Nullable(
    t.String({ description: 'The model the chat was last sent with; null: the agent default.' }),
  ),
  thinkingLevel: t.Nullable(
    t.String({ description: 'The reasoning level it was last sent with.' }),
  ),
  cliSessionId: t.Nullable(
    t.String({ description: 'The coding-agent session an external agent keeps for the chat.' }),
  ),
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
  jevFirstStage: t.Optional(jevFirstStageMode),
  title: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
  archived: t.Optional(t.Boolean()),
  issueId: t.Optional(t.Nullable(t.Integer({ description: 'The task to link, or null.' }))),
});

export const deleteChatQuery = t.Object({
  permanent: t.Optional(
    t.Boolean({ description: 'Delete a chat in the trash for good, with its messages.' }),
  ),
});

export const trashAllChatsBody = t.Object({
  projectKey: t.Optional(t.String({ description: 'Only the chats of this project.' })),
  view: t.Optional(
    oneOf(['active', 'archived'], {
      description: 'The list to empty into the trash: the chats (default) or the archive.',
    }),
  ),
});

export const emptyChatTrashBody = t.Object({
  confirmed: t.Literal(true),
  projectKey: t.Optional(t.String({ description: 'Only the chats of this project.' })),
});

export const ChatCountResponse = t.Object({ count: t.Integer() });

export const showVersionBody = t.Object({
  messageId: t.Integer({ description: 'The version to show: a message of the chat.' }),
});

export const issueChatParams = t.Object({ issueId: t.Numeric() });
