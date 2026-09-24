import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { AiChatAttachment, AiChatMessage } from '@/lib/api/endpoints/agentChat';

// Mirrors the API's CHAT_PROMPT_LIMIT (apps/api/.../chat/model.ts): the composer caps
// input at the same length the server accepts, so a member hits a visible limit on the
// textarea rather than a rejected send.
export const CHAT_PROMPT_LIMIT = 32_000;

// What the chat keeps about a message beside its parts. The server fills it in for a
// stored message; while an answer streams, the transport sets what it knows.
export interface PlanChatMetadata {
  createdAt?: string;
  parentId?: string | null;
  siblingIds?: string[];
  agentId?: number;
  attachments?: AiChatAttachment[];
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  stopped?: boolean;
  error?: string;
  // Why it failed, where the runtime's words said ('model-unavailable'), and the model: the
  // chat words it in the reader's language.
  errorCode?: string;
  errorModel?: string | null;
  // The browser lost the answer's stream before it ended (see AgUiChunkMapper.end); the
  // answer itself may still have finished on the operator's machine.
  interrupted?: boolean;
}

// `turn` is sent once a question is stored: the thread it went to and the id the
// server gave it, which replaces the id the browser gave it.
export type PlanChatData = {
  turn: { threadId: string; questionId: string; clientId: string };
};

export type PlanUIMessage = UIMessage<PlanChatMetadata, PlanChatData>;

// A tool's arguments and result arrive as text, mostly JSON. Parsed where they are, so
// the step can show them as structure.
export function parseToolText(text: string | undefined): unknown {
  if (text == null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toolPart(part: Extract<AiChatMessage['parts'][number], { type: 'tool' }>) {
  const base = {
    type: 'dynamic-tool' as const,
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    input: parseToolText(part.args) ?? {},
  };
  if (part.result == null) return { ...base, state: 'input-available' } as DynamicToolUIPart;
  if (part.isError) {
    return { ...base, state: 'output-error', errorText: part.result } as DynamicToolUIPart;
  }
  return { ...base, state: 'output-available', output: part.result } as DynamicToolUIPart;
}

// A stored message as the chat holds it.
export function toUIMessage(message: AiChatMessage): PlanUIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) => {
      if (part.type === 'tool') return toolPart(part);
      return { type: part.type, text: part.text, state: 'done' as const };
    }),
    metadata: {
      createdAt: message.createdAt,
      parentId: message.parentId,
      siblingIds: message.siblingIds,
      agentId: message.agentId,
      attachments: message.attachments,
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      durationMs: message.durationMs,
      stopped: message.stopped,
      error: message.error,
      ...(message.errorCode && { errorCode: message.errorCode }),
      ...(message.errorModel !== undefined && { errorModel: message.errorModel }),
    },
  };
}

// The text of a message, for copying, reading aloud and editing.
export function messageText(message: Pick<PlanUIMessage, 'parts'>): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
    .trim();
}

// The newest page of the transcript over what the chat holds: the pages loaded before
// it stay in front, everything from the first message of the page on is the server's.
export function mergeNewestPage(current: PlanUIMessage[], page: PlanUIMessage[]): PlanUIMessage[] {
  if (page.length === 0) return current;
  const firstId = page[0].id;
  const index = current.findIndex((message) => message.id === firstId);
  const earlier = index >= 0 ? current.slice(0, index) : [];
  const ids = new Set(page.map((message) => message.id));
  return [...earlier.filter((message) => !ids.has(message.id)), ...page];
}

// An older page of the transcript in front of what the chat holds, without the
// messages it already has (a page boundary can move while the thread grows).
export function mergeOlderPage(current: PlanUIMessage[], older: PlanUIMessage[]): PlanUIMessage[] {
  const ids = new Set(current.map((message) => message.id));
  return [...older.filter((message) => !ids.has(message.id)), ...current];
}
