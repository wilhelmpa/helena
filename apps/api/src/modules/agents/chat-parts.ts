import type { ChatPart } from './model';

// Building the parts of one chat message from the events the agent's runner reported.

// Adds text to the parts built so far, extending the last one when it is text: the
// stream arrives in chunks, and only a tool call between them starts a new part.
export function appendTextPart(parts: ChatPart[], text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last?.type === 'text') last.text += text;
  else parts.push({ type: 'text', text });
}

// The same for the model's reasoning, which a stretch of answer text or a tool call ends.
export function appendReasoningPart(parts: ChatPart[], text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning') last.text += text;
  else parts.push({ type: 'reasoning', text });
}
