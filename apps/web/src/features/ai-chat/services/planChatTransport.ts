import type { ChatRequestOptions, ChatTransport } from 'ai';
import {
  retryAiAgentChat,
  sendAiAgentChat,
  streamAnswerEvents,
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
}

const serverId = (id: string | undefined) =>
  id != null && /^\d+$/.test(id) ? Number(id) : undefined;

// The AI SDK's transport over Plan's chat API. The browser never talks to a model: a
// question is stored in Plan, a runner answers it through Hermes, and the answer is
// read back as the AG-UI events the runner reported, mapped to UI message chunks.
//
// A chat's thread is known after its first answer is queued; `threadId` holds it. An
// answer that was running before the page loaded is resumed from `resume`.
export class PlanChatTransport implements ChatTransport<PlanUIMessage> {
  threadId: string | null = null;
  resume: { messageId: number; agentId: number } | null = null;

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
      return this.answer(agentId, retried.messageId, [], options.abortSignal);
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
    return this.answer(agentId, sent.messageId, [turn], options.abortSignal);
  }

  async reconnectToStream(
    options: { chatId: string; abortSignal?: AbortSignal } & ChatRequestOptions,
  ): Promise<ReadableStream<PlanChunk> | null> {
    const resume = this.resume;
    this.resume = null;
    if (!resume) return null;
    return this.answer(resume.agentId, resume.messageId, [], options.abortSignal);
  }

  private answer(
    agentId: number,
    messageId: number,
    head: PlanChunk[],
    signal: AbortSignal | undefined,
  ): ReadableStream<PlanChunk> {
    const mapper = new AgUiChunkMapper(String(messageId), {
      createdAt: new Date().toISOString(),
      agentId,
    });
    const events = streamAnswerEvents(this.scopeKey, agentId, messageId, signal);
    return new ReadableStream<PlanChunk>({
      start(controller) {
        for (const chunk of [...head, ...mapper.start()]) controller.enqueue(chunk);
      },
      async pull(controller) {
        const next = await events.next();
        if (next.done) {
          for (const chunk of mapper.end()) controller.enqueue(chunk);
          controller.close();
          return;
        }
        for (const chunk of mapper.map(next.value)) controller.enqueue(chunk);
      },
      async cancel() {
        await events.return(undefined);
      },
    });
  }
}
