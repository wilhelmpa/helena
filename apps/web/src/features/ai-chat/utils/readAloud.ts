import { messageText, type PlanUIMessage } from './chatMessages';

// Which finished answer is read aloud by itself. Not every answer: only what answers a question
// that was spoken (or, in a running conversation, what the conversation reads itself), and
// everything only in a chat where the member turned "read everything" on — a typed question stays
// quiet otherwise (owner, 29.09.).
export function answerToRead(input: {
  messages: PlanUIMessage[];
  // "Alles vorlesen" is on for this chat.
  readAll: boolean;
  // A voice conversation is running: it reads the answers itself.
  talking: boolean;
  // How the question sent last in this session was given ('voice'), for one that has no record
  // of it yet.
  lastQuestionVia?: 'voice' | null;
}): string | null {
  const { messages, readAll, talking, lastQuestionVia } = input;
  if (talking) return null;
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  if (last.metadata?.stopped || last.metadata?.error || last.metadata?.interrupted) return null;
  const question = messages.findLast((message) => message.role === 'user');
  const spoken = lastQuestionVia === 'voice' || question?.metadata?.via === 'voice';
  if (!readAll && !spoken) return null;
  return messageText(last) || null;
}
