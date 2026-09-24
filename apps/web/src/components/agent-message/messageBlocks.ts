import type { DynamicToolUIPart } from 'ai';

// A message read as the stretches it is drawn in, in order: text, the model's reasoning,
// and the tool calls made between one stretch of text and the next — calls that follow
// one another become one block, shown together as one folded group (AgentToolGroup).
export type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; tools: DynamicToolUIPart[] };

// The part shape both functions read; every UIMessage part fits it.
type PartLike = { type: string; text?: string };

export function messageBlocks(message: { parts: readonly PartLike[] }): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      blocks.push({ kind: part.type, text: part.text ?? '' });
      continue;
    }
    if (part.type !== 'dynamic-tool') continue;
    const tool = part as unknown as DynamicToolUIPart;
    const last = blocks.at(-1);
    if (last?.kind === 'tools') last.tools.push(tool);
    else blocks.push({ kind: 'tools', tools: [tool] });
  }
  return blocks;
}

// All the Markdown a message carries, to decide which renderer plugins it needs.
export function messageMarkdown(message: { parts: readonly PartLike[] }): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' || part.type === 'reasoning' ? [part.text ?? ''] : []))
    .join('\n');
}
