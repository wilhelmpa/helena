import type { ModelRoute } from '@/lib/api/endpoints/decisions';
import type { LocalFallback } from '@/lib/api/endpoints/agentRuntimeSync';
import { API_URL, ApiError, apiFailure, request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import { EventSourceParserStream, type EventSourceMessage } from 'eventsource-parser/stream';

// The events of one SSE response (WHATWG HTML, "Server-sent events"), parsed by
// eventsource-parser: multi-line `data:`, CRLF, comments and `retry:` as the standard
// has them. `onId` sees every `id:` the stream sets — the last one is what a reconnect
// sends back as Last-Event-ID. Throws ApiError when the request failed before the stream.
async function* readSseEvents(
  res: Response,
  handlers: { onId?: (id: string) => void; onRetry?: (ms: number) => void } = {},
): AsyncGenerator<EventSourceMessage> {
  if (!res.ok || !res.body) throw await apiFailure(res);
  const reader = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream(handlers))
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    // A reader that stops early (the answer ended, or the caller left) lets go of the
    // connection instead of leaving it open until the server closes it.
    reader.cancel().catch(() => {});
  }
}

// What an external agent's runner reports while it answers, as AG-UI events
// (https://docs.ag-ui.com, typed in @ag-ui/core). Only the fields the chat reads are
// named; the rest of the protocol passes through and is ignored here.
export interface AgUiEvent {
  type: string;
  delta?: string;
  content?: string;
  message?: string;
  // A RUN_ERROR's code: a failure the runtime explained ('model-unavailable').
  code?: string;
  toolCallId?: string;
  toolCallName?: string;
  metadata?: Record<string, unknown>;
  // Older runners flagged a failed tool here; AG-UI 1.0 has no such field, and the flag
  // now travels in `metadata`.
  isError?: boolean;
}

// How many times in a row a dropped stream is picked up again before the browser stops
// following it. A connection that delivered something before it dropped resets the
// count: only a stream that keeps failing without progress is given up. The answer keeps
// being produced on the operator's machine either way; this only decides how long the
// browser follows it.
// `backoffMs` is the wait before the first reconnect, doubled for each one after it.
// Mutable only for tests.
export const chatStreamConfig = { retries: 5, backoffMs: 400 };

// Resolves after `ms`, or at once when `signal` is aborted.
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export function agentChatBase(scopeKey: string, agentId: number): string {
  const team = /^team:(\d+)$/.exec(scopeKey);
  return team
    ? '/teams/' + team[1] + '/ai-agents/' + agentId
    : '/projects/' + encodeURIComponent(scopeKey) + '/ai-agents/' + agentId;
}

// Asks the API to stop an answer. The runner reads the stop on its next report and ends
// the command; what the agent wrote until then stays in the transcript.
export const cancelAiAgentChatAnswer = (scopeKey: string, agentId: number, messageId: number) =>
  request<void>(`${agentChatBase(scopeKey, agentId)}/chat/${messageId}/cancel`, {
    method: 'POST',
  });

// Thrown by streamAnswerEvents when it gave up following an answer: the connection kept
// dropping, or kept closing before the answer ended. The answer itself may still be
// running on the operator's machine.
export class AnswerStreamLostError extends Error {
  constructor(cause?: unknown) {
    super('The connection to the answer was lost', { cause });
    this.name = 'AnswerStreamLostError';
  }
}

// The AG-UI events of one answer, from its first, until the answer ends on RUN_FINISHED
// or RUN_ERROR, which are yielded too. A dropped connection is picked up again from the
// last event read (Last-Event-ID) — the server also closes a stream on its
// own after a long while, which is a reconnect, not an end. Throws AnswerStreamLostError
// when it could not keep following the answer (see chatStreamConfig).
//
// By default aborting `signal` also asks the API to stop the answer — the old panel's
// meaning of closing its stream. `cancelOnAbort: false` keeps the two apart: leaving a
// conversation then only stops following it, and the answer finishes in the background
// (the chat workspace, where several chats may be answering at once, stops an answer
// explicitly with cancelAiAgentChatAnswer instead).
export async function* streamAnswerEvents(
  scopeKey: string,
  agentId: number,
  messageId: number,
  signal?: AbortSignal,
  options: { cancelOnAbort?: boolean } = {},
): AsyncGenerator<AgUiEvent> {
  const chat = agentChatBase(scopeKey, agentId) + '/chat/' + messageId;
  const cancel = () => {
    // A stop the API refused leaves the answer being produced. The stream this belongs
    // to is already gone, so the console is the only place left to report it.
    cancelAiAgentChatAnswer(scopeKey, agentId, messageId).catch((err) => {
      console.error('Could not stop the answer', err);
    });
  };
  const cancelOnAbort = options.cancelOnAbort ?? true;
  if (cancelOnAbort) {
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  }
  try {
    const url = `${API_URL}${chat}/stream`;
    // The id of the last event read, sent back on a reconnect as Last-Event-ID (the SSE
    // standard's resume), so the server continues after it.
    let lastEventId: string | null = null;
    // The server may ask for a reconnect delay with `retry:`; the backoff starts there.
    let retryMs = chatStreamConfig.backoffMs;
    let failures = 0;
    // The answer always ends on a terminal event, so a stream that closed without one was
    // cut: pick it up again from the last event already shown.
    for (;;) {
      let progressed = false;
      let lastError: unknown = null;
      try {
        const res = await fetch(url, {
          credentials: 'include',
          signal,
          headers: lastEventId != null ? { 'Last-Event-ID': lastEventId } : undefined,
        });
        const events = readSseEvents(res, {
          onId: (id) => {
            lastEventId = id;
          },
          onRetry: (ms) => {
            retryMs = ms;
          },
        });
        for await (const message of events) {
          progressed = true;
          if (message.event && message.event !== 'message') continue;
          const event = JSON.parse(message.data) as AgUiEvent;
          yield event;
          if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') return;
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        // Refused outright (the answer is not the caller's, or gone): asking again cannot
        // change that. Throttled or a server hiccup is worth another try.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          if (err.status !== 408 && err.status !== 429) throw new AnswerStreamLostError(err);
        }
        lastError = err;
      }
      if (signal?.aborted) return;
      failures = progressed ? 0 : failures + 1;
      if (failures > chatStreamConfig.retries) throw new AnswerStreamLostError(lastError);
      await pause(retryMs * 2 ** Math.max(0, failures - 1), signal);
      if (signal?.aborted) return;
    }
  } finally {
    if (cancelOnAbort) signal?.removeEventListener('abort', cancel);
  }
}

// The upload route takes the bytes as base64 rather than multipart, so the chat
// composer and an MCP client call the same route.
export async function uploadChatAttachment(
  projectKey: string,
  file: File,
): Promise<ChatAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
  return request(`/projects/${projectKey}/chat-attachments`, {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      contentType: file.type || undefined,
    }),
  });
}

// One of the caller's saved chat conversations with an agent. `title` is the first
// prompt (truncated); null when it was never set. `cliSessionId` is the coding agent
// session the agent's runner keeps for the thread on its own machine — null before the
// runner has reported one.
// `contextTokens` is the size of the conversation's context after its last completed
// answer: absent while no answer has completed, null where the agent reports no counts
// that can be read as one.
// `favorite` is the star the caller put on the conversation. `snippet` and `match` come
// back from a search: the text around the hit, and where it was found.
export interface AiChatThread {
  id: string;
  title: string | null;
  cliSessionId: string | null;
  model: string | null;
  thinkingLevel: string | null;
  contextTokens?: number | null;
  favorite: boolean;
  snippet?: string;
  match?: 'title' | 'user' | 'assistant';
  createdAt: string;
  updatedAt: string;
}

// One piece of a message, in the order the agent produced it: what it wrote, what it
// reasoned, and the tools it called between one stretch of text and the next. A call
// carries what it was given and what it answered where the agent reported them.
export interface AiChatToolPart {
  type: 'tool';
  toolCallId: string;
  toolName: string;
  args?: string;
  result?: string;
  isError?: boolean;
}

// A vault file or a task a question carries. `path` is relative to the vault.
export type AiChatAttachment =
  | { kind: 'file'; path: string; name: string; contentType: string; sizeBytes: number }
  | { kind: 'task'; issueId: number; identifier: string; title: string };

export type AiChatPart =
  { type: 'text'; text: string } | { type: 'reasoning'; text: string } | AiChatToolPart;

// One restored message of a chat thread's transcript. `stopped` marks an answer the
// member ended part-way: what the agent had written by then is all there is.
// An external agent's message also carries its place among its versions (`parentId`,
// `siblingIds` with itself among them), the agent that answered, what a question
// carried, and the model, tokens and duration of an answer. `error` is why it failed.
export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: AiChatPart[];
  createdAt: string;
  stopped?: boolean;
  parentId?: string | null;
  siblingIds?: string[];
  agentId?: number;
  attachments?: AiChatAttachment[];
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  error?: string;
  // Why it failed, where the runtime's words said ('model-unavailable'), and the model.
  errorCode?: string;
  errorModel?: string | null;
  // What the model router did for the answer (docs/helena-decisions/decisions.md §4).
  modelRoute?: ModelRoute | null;
  // A local model was asked for and the configured one answered.
  localFallback?: LocalFallback;
  // Said in the conversation mode, or answered by Helena's voice reply.
  via?: 'voice';
}

export interface AiChatThreadPage {
  items: AiChatThread[];
  nextPage: number | null;
}

export interface AiChatMessagePage {
  items: AiChatMessage[];
  nextPage: number | null;
  activeAnswer?: {
    messageId: number;
    agentId?: number;
    status: 'pending' | 'streaming';
    createdAt: string;
  };
}

export interface ChatAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

export interface AiChatModel {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  thinkingDefault: string | null;
  provider?: string;
  // Whether the account's own model list names it, and the model it is a variant of.
  listed?: boolean;
  variantOf?: string;
  // Confirmed (listed or seen working), only expected to work (false), or unknown (unset).
  verified?: boolean;
  // A model of Helena's local AI (`helena-<slug>/<id>`): on the owner's machine, free.
  local?: boolean;
}

// A model the provider refused this account, which the pickers leave out.
export interface UnavailableChatModel {
  id: string;
  provider?: string;
  detail: string | null;
  since: string;
  // The finding behind it, which "Erneut prüfen" forgets.
  findingId: number;
}

export interface AiChatCatalog {
  models: AiChatModel[];
  // Absent from an older server.
  unavailable?: UnavailableChatModel[];
  updatedAt: string | null;
}

export const getAiAgentChatCatalog = (scopeKey: string, agentId: number) =>
  request<AiChatCatalog>(agentChatBase(scopeKey, agentId) + '/chat/catalog');

// One page of the caller's own chat threads with an agent, newest first. `q` searches
// them by title and message text instead, over every page.
export const listAiAgentThreads = (scopeKey: string, agentId: number, page: number, q = '') =>
  request<AiChatThreadPage>(
    agentChatBase(scopeKey, agentId) +
      '/threads?page=' +
      page +
      (q ? `&q=${encodeURIComponent(q)}` : ''),
  );

// The conversations the caller starred with an agent, newest first, in one go.
export const listAiAgentFavoriteThreads = (scopeKey: string, agentId: number) =>
  request<AiChatThreadPage>(agentChatBase(scopeKey, agentId) + '/threads?favorites=true');

// Stars one of the caller's conversations, or takes the star off it.
export const setAiAgentThreadFavorite = (
  scopeKey: string,
  agentId: number,
  threadId: string,
  favorite: boolean,
) =>
  request<void>(
    agentChatBase(scopeKey, agentId) + '/threads/' + encodeURIComponent(threadId) + '/favorite',
    { method: favorite ? 'PUT' : 'DELETE' },
  );

// The transcript of one chat thread, to restore the conversation.
export const getAiAgentThreadMessages = (
  scopeKey: string,
  agentId: number,
  threadId: string,
  page: number,
) =>
  request<AiChatMessagePage>(
    agentChatBase(scopeKey, agentId) +
      '/threads/' +
      encodeURIComponent(threadId) +
      '/messages?page=' +
      page,
  );

// Renames one of the caller's chat threads.
export const renameAiAgentThread = (
  scopeKey: string,
  agentId: number,
  threadId: string,
  title: string,
) =>
  request<void>(agentChatBase(scopeKey, agentId) + '/threads/' + encodeURIComponent(threadId), {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

export const deleteAiAgentThread = (scopeKey: string, agentId: number, threadId: string) =>
  request<void>(agentChatBase(scopeKey, agentId) + '/threads/' + encodeURIComponent(threadId), {
    method: 'DELETE',
  });

// Sends a question and returns where its answer is produced. `parentId` is the message
// it follows (null starts the chat over, as an edited first question does); left out,
// the message the chat shows last.
export const sendAiAgentChat = (
  scopeKey: string,
  agentId: number,
  input: {
    prompt: string;
    threadId?: string;
    parentId?: number | null;
    attachments?: { files?: string[]; issueIds?: number[] };
    model?: string | null;
    thinkingLevel?: string | null;
    // Said in the conversation mode: the agent answers short and speakable.
    via?: 'voice';
  },
) =>
  request<{ threadId: string; messageId: number; userMessageId: number }>(
    agentChatBase(scopeKey, agentId) + '/chat',
    { method: 'POST', body: JSON.stringify(input) },
  );

// Answers a question again, next to the answers it already has.
export const retryAiAgentChat = (
  scopeKey: string,
  agentId: number,
  input: { threadId: string; questionId: number },
) =>
  request<{ threadId: string; messageId: number }>(
    agentChatBase(scopeKey, agentId) + '/chat/retry',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );

export type ChatListView = 'active' | 'archived' | 'trash';

// One of the caller's chats as the chat list shows it. A chat without a project is a
// Home chat, addressed through its agent's team.
export type JevFirstStageMode = 'inherit' | 'on' | 'off';

export interface ChatSummary {
  jevFirstStage: JevFirstStageMode;
  id: string;
  title: string | null;
  agent: { id: number; name: string; username: string };
  teamId: number;
  project: { id: number; key: string; name: string } | null;
  issue: { id: number; identifier: string; title: string } | null;
  pinned: boolean;
  running: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  snippet?: string;
  match?: 'title' | 'user' | 'assistant';
  createdAt: string;
  updatedAt: string;
  // The model and reasoning level the chat was last sent with (null: the agent's
  // default), and the coding-agent session an external agent keeps for it.
  model: string | null;
  thinkingLevel: string | null;
  cliSessionId: string | null;
  // The context size after the chat's last completed answer: absent while no answer
  // has completed, null where the agent reports no counts that can be read as one.
  contextTokens?: number | null;
}

// The scope a chat's agent routes take: its project, or the team for a Home chat.
export const chatScopeKey = (chat: Pick<ChatSummary, 'project' | 'teamId'>) =>
  chat.project ? chat.project.key : `team:${chat.teamId}`;

export const listChats = (
  params: PageParams,
  filters: { projectKey?: string; agentId?: number; q?: string; view?: ChatListView } = {},
) =>
  request<Page<ChatSummary>>(
    '/chats' +
      pageQuery(params, {
        projectKey: filters.projectKey,
        agentId: filters.agentId == null ? undefined : String(filters.agentId),
        q: filters.q,
        view: filters.view,
      }),
  );

export const getChat = (threadId: string) =>
  request<ChatSummary>('/chats/' + encodeURIComponent(threadId));

export const updateChat = (
  threadId: string,
  patch: {
    title?: string;
    archived?: boolean;
    issueId?: number | null;
    jevFirstStage?: JevFirstStageMode;
  },
) =>
  request<void>('/chats/' + encodeURIComponent(threadId), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const setChatPinned = (threadId: string, pinned: boolean) =>
  request<void>('/chats/' + encodeURIComponent(threadId) + '/pin', {
    method: pinned ? 'PUT' : 'DELETE',
  });

export const deleteChat = (threadId: string, permanent = false) =>
  request<void>('/chats/' + encodeURIComponent(threadId) + (permanent ? '?permanent=true' : ''), {
    method: 'DELETE',
  });

export const restoreChat = (threadId: string) =>
  request<void>('/chats/' + encodeURIComponent(threadId) + '/restore', { method: 'POST' });

// Shows another version of a message, with the newest conversation after it.
export const showChatVersion = (threadId: string, messageId: number) =>
  request<void>('/chats/' + encodeURIComponent(threadId) + '/active', {
    method: 'PUT',
    body: JSON.stringify({ messageId }),
  });

// The caller's chats linked to a task.
export const listIssueChats = (issueId: number) =>
  request<ChatSummary[]>(`/issues/${issueId}/chats`);
