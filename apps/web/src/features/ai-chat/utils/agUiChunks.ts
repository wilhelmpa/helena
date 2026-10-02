import type { InferUIMessageChunk } from 'ai';
import {
  EventType,
  contentToText,
  type ReasoningMessageChunkEvent,
  type ReasoningMessageContentEvent,
  type RunErrorEvent,
  type TextMessageChunkEvent,
  type TextMessageContentEvent,
  type ToolCallArgsEvent,
  type ToolCallChunkEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/core';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { toolResultFailed, outcomeMetadata } from '@/components/agent-message/toolOutcome';
import { parseToolText, type PlanChatMetadata, type PlanUIMessage } from './chatMessages';

export type PlanChunk = InferUIMessageChunk<PlanUIMessage>;

// AG-UI before 1.0 named the reasoning events THINKING_*; Helena's runner still reports
// the model's thinking that way.
const LEGACY_THINKING_CONTENT = 'THINKING_TEXT_MESSAGE_CONTENT';
const LEGACY_THINKING_END = 'THINKING_TEXT_MESSAGE_END';

// The fields an event of a given AG-UI type carries (events arrive as parsed JSON).
const as = <T>(event: AgUiEvent) => event as unknown as Partial<T>;

// Turns the AG-UI events of one answer, as Helena's runner reports them, into the chunks
// the AI SDK builds a message from — the one piece between the two standards that no
// library provides (AG-UI's own Vercel integration goes the other way). Text and
// reasoning arrive as deltas and are opened and closed as blocks here; a tool call
// becomes a dynamic tool part that goes from its arguments to its result or its error.
// Both the AG-UI 1.0 names (REASONING_*, the *_CHUNK shorthands) and the older THINKING_*
// are read.
export class AgUiChunkMapper {
  private open: { kind: 'text' | 'reasoning'; id: string } | null = null;
  private blocks = 0;
  private readonly tools = new Map<string, { name: string; args: string; ready: boolean }>();
  // The tool call a TOOL_CALL_CHUNK without an id continues.
  private lastTool: string | null = null;
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
      case EventType.TEXT_MESSAGE_CONTENT:
      case EventType.TEXT_MESSAGE_CHUNK: {
        const { delta } = as<TextMessageContentEvent | TextMessageChunkEvent>(event);
        return delta ? this.delta('text', delta) : [];
      }
      case EventType.REASONING_MESSAGE_CONTENT:
      case EventType.REASONING_MESSAGE_CHUNK:
      case LEGACY_THINKING_CONTENT: {
        const { delta } = as<ReasoningMessageContentEvent | ReasoningMessageChunkEvent>(event);
        return delta ? this.delta('reasoning', delta) : [];
      }
      case EventType.TEXT_MESSAGE_END:
      case EventType.REASONING_MESSAGE_END:
      case EventType.REASONING_END:
      case LEGACY_THINKING_END:
        return this.close();
      case EventType.TOOL_CALL_START: {
        const { toolCallId, toolCallName } = as<ToolCallStartEvent>(event);
        return this.startTool(toolCallId ?? '', toolCallName);
      }
      case EventType.TOOL_CALL_ARGS: {
        const { toolCallId, delta } = as<ToolCallArgsEvent>(event);
        return this.toolArgs(toolCallId ?? '', delta);
      }
      case EventType.TOOL_CALL_CHUNK: {
        // The shorthand for START + ARGS: the first chunk of a call names it.
        const chunk = as<ToolCallChunkEvent>(event);
        const id = chunk.toolCallId ?? this.lastTool ?? '';
        const started = this.tools.has(id) ? [] : this.startTool(id, chunk.toolCallName);
        return [...started, ...this.toolArgs(id, chunk.delta)];
      }
      case EventType.TOOL_CALL_END:
        return this.toolReady(as<ToolCallArgsEvent>(event).toolCallId ?? '');
      case EventType.TOOL_CALL_RESULT: {
        const result = as<
          ToolCallResultEvent & {
            isError?: boolean;
            metadata?: {
              isError?: boolean;
              outcome?: 'ok' | 'nonzero_with_output' | 'error';
              exitCode?: number | null;
            };
          }
        >(event);
        const id = result.toolCallId ?? '';
        if (!this.tools.has(id)) return [];
        // AG-UI has no error flag on a result; Helena's runner puts MCP's `isError` into
        // the event's metadata (older runners sent it on the event itself).
        const outcome = result.metadata?.outcome;
        const failed = toolResultFailed({
          ...result.metadata,
          isError: result.metadata?.isError === true || result.isError === true,
        });
        const providerMetadata = outcomeMetadata(outcome, result.metadata?.exitCode);
        // AG-UI 1.0 lets a result be content parts; the chat shows their text.
        const content =
          typeof result.content === 'string' ? result.content : contentToText(result.content ?? []);
        return [
          ...this.toolReady(id),
          failed
            ? {
                type: 'tool-output-error',
                toolCallId: id,
                errorText: content,
                dynamic: true,
                ...(providerMetadata && { providerMetadata }),
              }
            : {
                type: 'tool-output-available',
                toolCallId: id,
                output: content,
                dynamic: true,
                ...(providerMetadata && { providerMetadata }),
              },
        ];
      }
      case EventType.RUN_FINISHED:
        return this.finish();
      case EventType.RUN_ERROR: {
        const { message, code } = as<RunErrorEvent>(event);
        return this.finish({
          error: message || 'The agent stopped answering',
          ...(code && { errorCode: code }),
        });
      }
      default:
        return [];
    }
  }

  // Closes the message when the stream ended without a terminal event: the browser lost
  // the answer rather than the answer ending, so it is marked as interrupted, for the
  // chat to offer picking it up again.
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

  private startTool(id: string, name: string | undefined): PlanChunk[] {
    const toolName = name || 'tool';
    this.tools.set(id, { name: toolName, args: '', ready: false });
    this.lastTool = id;
    return [...this.close(), { type: 'tool-input-start', toolCallId: id, toolName, dynamic: true }];
  }

  private toolArgs(id: string, delta: string | undefined): PlanChunk[] {
    const tool = this.tools.get(id);
    if (!tool || !delta) return [];
    tool.args += delta;
    return [{ type: 'tool-input-delta', toolCallId: id, inputTextDelta: delta }];
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
