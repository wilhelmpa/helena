import { messageText, type PlanUIMessage } from './chatMessages';

export interface ChatNoteLabels {
  question: string;
  answer: (agent: string) => string;
  source: (agent: string, date: string) => string;
}

// A chat, or one answer of it, as a Markdown note for the vault: the questions and
// answers as they read, without the reasoning and the tool calls.
export function chatNoteMarkdown(input: {
  title: string;
  agentName: (message: PlanUIMessage) => string;
  messages: PlanUIMessage[];
  date: string;
  labels: ChatNoteLabels;
}): string {
  const agent = input.agentName(
    input.messages.find((m) => m.role === 'assistant') ?? input.messages[0],
  );
  const lines = [`# ${input.title}`, '', `> ${input.labels.source(agent, input.date)}`, ''];
  for (const message of input.messages) {
    const text = messageText(message);
    if (!text) continue;
    lines.push(
      message.role === 'user'
        ? `## ${input.labels.question}`
        : `## ${input.labels.answer(input.agentName(message))}`,
      '',
      text,
      '',
    );
  }
  return lines.join('\n').trimEnd() + '\n';
}

// The file the note is written to, in the Docs folder, named after the chat and the
// moment it was saved so a second save does not collide with the first.
export function chatNotePath(title: string, now: Date): string {
  const base = title
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
  return `Docs/${base || 'Chat'} ${stamp}.md`;
}
