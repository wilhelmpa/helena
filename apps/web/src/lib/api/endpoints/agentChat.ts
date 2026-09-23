import { API_URL, ApiError, apiFailure, request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { AgentRunEvent } from '@/lib/api/endpoints/agents';

// The frames of one SSE connection: separated by a blank line, each carrying a single
// JSON-encoded event on its `data:` line and, on a resumable stream, the `id:` a
// reconnect resumes from. Throws ApiError when the request failed before the stream.
async function* readSseFrames(res: Response): AsyncGenerator<{ id: number | null; data: string }> {
  if (!res.ok || !res.body) throw await apiFailure(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const lines = buffer.slice(0, sep).split('\n');
        buffer = buffer.slice(sep + 2);
        const dataLine = lines.find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const idLine = lines.find((l) => l.startsWith('id:'));
        yield {
          id: idLine ? Number(idLine.slice(3).trim()) : null,
          data: dataLine.slice(5).trim(),
        };
      }
    }
  } finally {
    // A reader that stops early (the answer ended, or the caller left) lets go of the
    // connection instead of leaving it open until the server closes it.
    reader.cancel().catch(() => {});
  }
}

// What an external agent's runner reports while it answers, as AG-UI events
// (https://docs.ag-ui.com). Only the ones the chat renders are named; the rest of the
// protocol passes through and is ignored here.
export interface AgUiEvent {
  type: string;
  delta?: string;
  content?: string;
  message?: string;
  toolCallId?: string;
  toolCallName?: string;
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

function toRunEvent(event: AgUiEvent): AgentRunEvent | null {
  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return { type: 'text', value: event.delta ?? '' };
    case 'THINKING_TEXT_MESSAGE_CONTENT':
      return { type: 'reasoning', value: event.delta ?? '' };
    case 'TOOL_CALL_START':
      return {
        type: 'tool-start',
        toolCallId: event.toolCallId ?? '',
        toolName: event.toolCallName ?? '',
      };
    case 'TOOL_CALL_ARGS':
      return { type: 'tool-args', toolCallId: event.toolCallId ?? '', delta: event.delta ?? '' };
    // TOOL_CALL_END closes the call's arguments, which the runner reports in the same
    // batch as the call itself. The tool is done when its result arrives.
    case 'TOOL_CALL_RESULT':
      return { type: 'tool-end', toolCallId: event.toolCallId ?? '', result: event.content };
    default:
      return null;
  }
}

// The run is bound to this connection, so aborting `signal` is the whole stop: the API
// drops the run with it.
// Streams an internal agent's response over SSE, yielding each AgentRunEvent as it
// arrives. Sends the session cookie like every other call. Throws ApiError when the
// request itself fails before the stream starts (e.g. 403/404); a failure during
// the run arrives as an `error` event, not a throw.
export async function* streamAiAgentRun(
  projectKey: string,
  agentId: number,
  input: { prompt: string; threadId?: string | null },
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEvent> {
  const body = input.threadId
    ? { prompt: input.prompt, threadId: input.threadId }
    : { prompt: input.prompt };
  const res = await fetch(`${API_URL}/projects/${projectKey}/ai-agents/${agentId}/run/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  for await (const frame of readSseFrames(res)) {
    yield JSON.parse(frame.data) as AgentRunEvent;
  }
}

// Dropping the stream stops nothing here — the runner is on the operator's machine and
// only ever calls the API itself — so aborting `signal` also asks the API to cancel the
// answer, which is what the runner reads on its next report.
// Sends a message to an external agent and streams the answer its runner produces,
// yielding the same events as an internal agent's run so the chat consumes one shape.
// The answer starts only once a runner takes the message: until then the stream is open
// with nothing on it.
export async function* streamAiAgentChat(
  scopeKey: string,
  agentId: number,
  input: {
    prompt: string;
    threadId?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEvent> {
  const body = { ...input, threadId: input.threadId || undefined };
  const sent = await request<{ threadId: string; messageId: number }>(
    agentChatBase(scopeKey, agentId) + '/chat',
    { method: 'POST', body: JSON.stringify(body) },
  );
  // Persist the new tab as soon as the API has created its thread. If the page reloads
  // while Hermes is still answering, the history remains reachable instead of looking
  // like a chat that never existed.
  yield { type: 'done', threadId: sent.threadId };
  yield* streamExistingAiAgentChat(scopeKey, agentId, sent.messageId, signal);
}

// Reattaches a reloaded browser to the answer already being produced for a persisted
// thread. It never creates a message, so reconnecting cannot make Hermes answer the
// member's prompt twice.
export function resumeAiAgentChat(
  scopeKey: string,
  agentId: number,
  messageId: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEvent> {
  return streamExistingAiAgentChat(scopeKey, agentId, messageId, signal);
}

async function* streamExistingAiAgentChat(
  scopeKey: string,
  agentId: number,
  messageId: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEvent> {
  for await (const event of streamAnswerEvents(scopeKey, agentId, messageId, signal)) {
    if (event.type === 'RUN_ERROR') {
      yield { type: 'error', message: event.message ?? 'The agent stopped answering' };
      continue;
    }
    const mapped = toRunEvent(event);
    if (mapped) yield mapped;
  }
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

// The AG-UI events of one answer, from the event after `after` (0: the first), until the
// answer ends on RUN_FINISHED or RUN_ERROR, which are yielded too. A dropped connection
// is picked up again from the last event read — the server also closes a stream on its
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
    const base = `${API_URL}${chat}/stream`;
    let after = 0;
    let failures = 0;
    // The answer always ends on a terminal event, so a stream that closed without one was
    // cut: pick it up again from the last event already shown.
    for (;;) {
      let progressed = false;
      let lastError: unknown = null;
      try {
        const res = await fetch(`${base}?after=${after}`, { credentials: 'include', signal });
        for await (const frame of readSseFrames(res)) {
          progressed = true;
          after = frame.id ?? after;
          const event = JSON.parse(frame.data) as AgUiEvent;
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
      await pause(chatStreamConfig.backoffMs * 2 ** Math.max(0, failures - 1), signal);
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
// session an external agent's runner keeps for the thread on its own machine — null
// before the runner has reported one, and always null for an internal agent.
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
}

export interface AiChatCatalog {
  models: AiChatModel[];
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
export interface ChatSummary {
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
  patch: { title?: string; archived?: boolean; issueId?: number | null },
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
