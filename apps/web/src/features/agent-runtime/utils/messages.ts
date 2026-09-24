import { readUIMessageStream, type DynamicToolUIPart } from 'ai';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import type { Transcript, TranscriptMessage } from '@/lib/api/endpoints/agentRuntime';
import { AgUiChunkMapper, type PlanChunk } from '@/features/ai-chat/utils/agUiChunks';
import type { PlanUIMessage } from '@/features/ai-chat/utils/chatMessages';

// A run's timeline and a session's transcript as the AI SDK message parts the chat renders
// (reasoning, tool calls with their results, text), so a run reads like a chat answer.

// The AG-UI events of a run, read into one assistant message the way the chat reads an
// answer's stream: through the chat's own chunk mapper and the AI SDK's message reader.
export async function runEventsToMessage(
  events: AgUiEvent[],
  id: string,
): Promise<PlanUIMessage | null> {
  if (events.length === 0) return null;
  const mapper = new AgUiChunkMapper(id);
  const chunks: PlanChunk[] = [...mapper.start(), ...events.flatMap((event) => mapper.map(event))];
  const stream = new ReadableStream<PlanChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let message: PlanUIMessage | null = null;
  for await (const next of readUIMessageStream<PlanUIMessage>({ stream })) message = next;
  return message;
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

// The messages of a transcript as chat messages: a person's turn, then everything the agent
// did until the next one (its reasoning, its tool calls with their results, its text) as
// one answer, in order.
export function transcriptToMessages(transcript: Transcript): PlanUIMessage[] {
  const out: PlanUIMessage[] = [];
  let answer: PlanUIMessage | null = null;
  const tools = new Map<string, DynamicToolUIPart>();
  const answerFor = (message: TranscriptMessage): PlanUIMessage => {
    if (!answer) {
      answer = {
        id: `a-${message.id}`,
        role: 'assistant',
        parts: [],
        metadata: {
          createdAt: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
          model: message.model ?? transcript.session.model,
        },
      };
      out.push(answer);
    }
    return answer;
  };
  for (const message of transcript.messages) {
    if (message.role === 'user' || message.role === 'system') {
      answer = null;
      const text = message.parts
        .map((part) => (part.type === 'text' ? part.content : ''))
        .filter(Boolean)
        .join('\n\n');
      if (!text) continue;
      out.push({
        id: `u-${message.id}`,
        role: message.role === 'system' ? 'system' : 'user',
        parts: [{ type: 'text', text, state: 'done' }],
        metadata: {
          createdAt: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
        },
      });
      continue;
    }
    const target = answerFor(message);
    for (const part of message.parts) {
      if (part.type === 'text')
        target.parts.push({ type: 'text', text: part.content, state: 'done' });
      else if (part.type === 'reasoning')
        target.parts.push({ type: 'reasoning', text: part.content, state: 'done' });
      else if (part.type === 'compaction' && part.content)
        target.parts.push({ type: 'reasoning', text: part.content, state: 'done' });
      else if (part.type === 'tool_call') {
        const tool = {
          type: 'dynamic-tool',
          toolName: part.name,
          toolCallId: part.id ?? `${message.id}-${target.parts.length}`,
          state: 'input-available',
          input: part.arguments ?? {},
        } as DynamicToolUIPart;
        tools.set(tool.toolCallId, tool);
        target.parts.push(tool);
      } else if (part.type === 'tool_call_response') {
        const call = part.id ? tools.get(part.id) : undefined;
        const index = call ? target.parts.indexOf(call) : -1;
        const done = (
          part.isError
            ? {
                ...(call ?? { type: 'dynamic-tool', toolName: part.name ?? 'tool', input: {} }),
                toolCallId: call?.toolCallId ?? part.id ?? `${message.id}-r`,
                state: 'output-error',
                errorText: stringify(part.response),
              }
            : {
                ...(call ?? { type: 'dynamic-tool', toolName: part.name ?? 'tool', input: {} }),
                toolCallId: call?.toolCallId ?? part.id ?? `${message.id}-r`,
                state: 'output-available',
                output: part.response,
              }
        ) as DynamicToolUIPart;
        if (index >= 0) target.parts[index] = done;
        else target.parts.push(done);
      }
    }
  }
  return out;
}
