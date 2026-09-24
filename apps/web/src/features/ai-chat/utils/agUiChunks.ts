import type { InferUIMessageChunk } from 'ai';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { parseToolText, type PlanChatMetadata, type PlanUIMessage } from './chatMessages';

export type PlanChunk = InferUIMessageChunk<PlanUIMessage>;

// Turns the AG-UI events of one answer, as Plan's runner reports them, into the chunks
// the AI SDK builds a message from. Text and reasoning arrive as deltas and are opened
// and closed as blocks here; a tool call becomes a dynamic tool part that goes from its
// arguments to its result or its error.
export class AgUiChunkMapper {
  private open: { kind: 'text' | 'reasoning'; id: string } | null = null;
  private blocks = 0;
  private readonly tools = new Map<string, { name: string; args: string; ready: boolean }>();
  private finished = false;

  constructor(
    private readonly messageId: string,
    private readonly metadata: PlanChatMetadata = {},
  ) {}

  start(): PlanChunk[] {
    return [{ type: 'start', messageId: this.messageId, messageMetadata: this.metadata }];
  }

  map(event: AgUiEvent): PlanChunk[] {
    switch (event.type) {
      case 'TEXT_MESSAGE_CONTENT':
        return event.delta ? this.delta('text', event.delta) : [];
      case 'THINKING_TEXT_MESSAGE_CONTENT':
        return event.delta ? this.delta('reasoning', event.delta) : [];
      case 'TEXT_MESSAGE_END':
        return this.close();
      case 'TOOL_CALL_START': {
        const id = event.toolCallId ?? '';
        const name = event.toolCallName || 'tool';
        this.tools.set(id, { name, args: '', ready: false });
        return [
          ...this.close(),
          { type: 'tool-input-start', toolCallId: id, toolName: name, dynamic: true },
        ];
      }
      case 'TOOL_CALL_ARGS': {
        const tool = this.tools.get(event.toolCallId ?? '');
        if (!tool || !event.delta) return [];
        tool.args += event.delta;
        return [
          { type: 'tool-input-delta', toolCallId: event.toolCallId!, inputTextDelta: event.delta },
        ];
      }
      case 'TOOL_CALL_END':
        return this.toolReady(event.toolCallId ?? '');
      case 'TOOL_CALL_RESULT': {
        const id = event.toolCallId ?? '';
        if (!this.tools.has(id)) return [];
        const content = event.content ?? '';
        return [
          ...this.toolReady(id),
          event.isError
            ? { type: 'tool-output-error', toolCallId: id, errorText: content, dynamic: true }
            : { type: 'tool-output-available', toolCallId: id, output: content, dynamic: true },
        ];
      }
      case 'RUN_FINISHED':
        return this.finish();
      case 'RUN_ERROR':
        return this.finish({ error: event.message || 'The agent stopped answering' });
      default:
        return [];
    }
  }

  // Closes the message when the stream ended without a terminal event: the browser lost
  // the answer rather than the answer ending, so it is marked as interrupted, for the
  // chat to offer picking it up again (see ChatInterruptedBar).
  end(): PlanChunk[] {
    return this.finished ? [] : this.finish({ interrupted: true });
  }

  private delta(kind: 'text' | 'reasoning', delta: string): PlanChunk[] {
    const chunks: PlanChunk[] = [];
    if (this.open?.kind !== kind) {
      chunks.push(...this.close());
      this.open = { kind, id: `${kind}-${++this.blocks}` };
      chunks.push({ type: `${kind}-start`, id: this.open.id });
    }
    chunks.push({ type: `${kind}-delta`, id: this.open.id, delta });
    return chunks;
  }

  private close(): PlanChunk[] {
    if (!this.open) return [];
    const { kind, id } = this.open;
    this.open = null;
    return [{ type: `${kind}-end`, id }];
  }

  // A call's arguments are complete once it ends, or once its result arrives from a
  // runner that reports no end.
  private toolReady(id: string): PlanChunk[] {
    const tool = this.tools.get(id);
    if (!tool || tool.ready) return [];
    tool.ready = true;
    return [
      {
        type: 'tool-input-available',
        toolCallId: id,
        toolName: tool.name,
        input: parseToolText(tool.args) ?? {},
        dynamic: true,
      },
    ];
  }

  private finish(metadata?: PlanChatMetadata): PlanChunk[] {
    this.finished = true;
    const finishReason = metadata?.error ? 'error' : metadata?.interrupted ? 'other' : 'stop';
    return [
      ...this.close(),
      ...(metadata ? [{ type: 'message-metadata' as const, messageMetadata: metadata }] : []),
      { type: 'finish', finishReason },
    ];
  }
}
