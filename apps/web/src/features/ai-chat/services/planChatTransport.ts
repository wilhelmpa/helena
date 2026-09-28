import type { ChatRequestOptions, ChatTransport } from 'ai';
import {
  cancelAiAgentChatAnswer,
  retryAiAgentChat,
  sendAiAgentChat,
  streamAnswerEvents,
  type AgUiEvent,
} from '@/lib/api/endpoints/agentChat';
import { AgUiChunkMapper, type PlanChunk } from '../utils/agUiChunks';
import { messageText, type PlanUIMessage } from '../utils/chatMessages';

// What a send carries besides the question's text, passed as the `body` of the AI SDK
// request: the agent that answers (another one than the chat's, when addressed with @),
// the message the question follows when it is an edit, its attachments, and the model
// the chat uses.
export interface PlanSendOptions {
  agentId?: number;
  parentId?: number | null;
  files?: string[];
  issueIds?: number[];
  model?: string | null;
  thinkingLevel?: string | null;
  // 'voice': said in the conversation mode; the answer is read aloud (features/voice).
  via?: 'voice';
  context?: { projectKey: string | null; path: string };
}

// The answer a stream follows: which agent produces it, and the message it is stored as.
export interface PlanAnswerRef {
  agentId: number;
  messageId: number;
  // When the answer was queued, for the message's timestamp; now when unknown.
  createdAt?: string;
}

const serverId = (id: string | undefined) =>
  id != null && /^\d+$/.test(id) ? Number(id) : undefined;

// The AI SDK's transport over Plan's chat API. The browser never talks to a model: a
// question is stored in Plan, a runner answers it through Hermes, and the answer is
// read back as the AG-UI events the runner reported, mapped to UI message chunks.
//
// A chat's thread is known after its first answer is queued; `threadId` holds it. An
// answer that was running before the page loaded, or whose stream was lost, is picked up
// again from `resume` (see reconnectToStream).
//
// Closing a stream only stops following the answer — it keeps being produced, and the
// chat list shows it running — so leaving a conversation never stops its agent. Stopping
// is its own request (`cancel`), sent only when the member presses stop.
export class PlanChatTransport implements ChatTransport<PlanUIMessage> {
  threadId: string | null = null;
  resume: PlanAnswerRef | null = null;
  // The answer the current stream follows, for `cancel`. Null between answers.
  active: PlanAnswerRef | null = null;

  constructor(
    readonly scopeKey: string,
    public agentId: number,
  ) {}

  async sendMessages(
    options: {
      trigger: 'submit-message' | 'regenerate-message';
      chatId: string;
      messageId: string | undefined;
      messages: PlanUIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<PlanChunk>> {
    const send = (options.body ?? {}) as PlanSendOptions;
    const agentId = send.agentId ?? this.agentId;
    const question = options.messages.at(-1);
    if (options.trigger === 'regenerate-message') {
      const questionId = serverId(question?.id);
      if (!this.threadId || questionId == null) throw new Error('Nothing to answer again');
      const retried = await retryAiAgentChat(this.scopeKey, agentId, {
        threadId: this.threadId,
        questionId,
      });
      return this.answer({ agentId, messageId: retried.messageId }, [], options.abortSignal);
    }
    const previous = options.messages.at(-2);
    const sent = await sendAiAgentChat(this.scopeKey, agentId, {
      prompt: question ? messageText(question) : '',
      threadId: this.threadId ?? undefined,
      parentId: send.parentId !== undefined ? send.parentId : serverId(previous?.id),
      attachments:
        send.files?.length || send.issueIds?.length
          ? { files: send.files, issueIds: send.issueIds }
          : undefined,
      ...(send.model !== undefined && { model: send.model, thinkingLevel: send.thinkingLevel }),
      ...(send.via && { via: send.via }),
      ...(send.context && { context: send.context }),
    });
    this.threadId = sent.threadId;
    const turn: PlanChunk = {
      type: 'data-turn',
      transient: true,
      data: {
        threadId: sent.threadId,
        questionId: String(sent.userMessageId),
        clientId: question?.id ?? '',
      },
    };
    return this.answer({ agentId, messageId: sent.messageId }, [turn], options.abortSignal);
  }

  async reconnectToStream(
    options: { chatId: string; abortSignal?: AbortSignal } & ChatRequestOptions,
  ): Promise<ReadableStream<PlanChunk> | null> {
    const resume = this.resume;
    this.resume = null;
    if (!resume) return null;
    return this.answer(resume, [], options.abortSignal);
  }

  // Stops the answer being followed. Resolves once the API took the stop; the stream
  // then ends on its own with what the agent wrote so far.
  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    await cancelAiAgentChatAnswer(this.scopeKey, active.agentId, active.messageId);
  }

  private answer(
    ref: PlanAnswerRef,
    head: PlanChunk[],
    signal: AbortSignal | undefined,
  ): ReadableStream<PlanChunk> {
    this.active = ref;
    const mapper = new AgUiChunkMapper(String(ref.messageId), {
      createdAt: ref.createdAt ?? new Date().toISOString(),
      agentId: ref.agentId,
    });
    const events = streamAnswerEvents(this.scopeKey, ref.agentId, ref.messageId, signal, {
      cancelOnAbort: false,
    });
    const done = () => {
      if (this.active === ref) this.active = null;
    };
    return new ReadableStream<PlanChunk>({
      start(controller) {
        for (const chunk of [...head, ...mapper.start()]) controller.enqueue(chunk);
      },
      // Most AG-UI events (RUN_STARTED, TEXT_MESSAGE_START, TOOL_CALL_END, …) map to no
      // chunk at all. A pull that enqueues nothing is never called again — the stream
      // only pulls once more when something was read or asked for while it pulled — so
      // this keeps reading until it has a chunk to hand over or the answer is over.
      // Returning empty-handed is what left answers hanging at "Thinking …".
      async pull(controller) {
        for (;;) {
          let next: IteratorResult<AgUiEvent, void>;
          try {
            next = await events.next();
          } catch (err) {
            done();
            if (signal?.aborted) throw err;
            // Lost, not failed: the answer may still be running. The message says so,
            // and the chat offers to follow it again.
            for (const chunk of mapper.end()) controller.enqueue(chunk);
            controller.close();
            return;
          }
          if (next.done) {
            done();
            for (const chunk of mapper.end()) controller.enqueue(chunk);
            controller.close();
            return;
          }
          const chunks = mapper.map(next.value);
          for (const chunk of chunks) controller.enqueue(chunk);
          if (chunks.length > 0) return;
        }
      },
      async cancel() {
        done();
        await events.return(undefined);
      },
    });
  }
}
