import { readVoiceSettings } from './settings';

// Spoken turns of a chat (docs/helena-decisions/voice-2.md §4): what the conversation mode
// sends is read by the agent like a typed message, with a note that its answer will be heard,
// not read. Without it agents answered a spoken "Wie viele Aufgaben sind offen?" with a table.

const SPOKEN_NOTE =
  '[Said in a voice conversation; your answer will be read aloud. Answer in one to three ' +
  'short, natural spoken sentences in the language of the person: no Markdown, lists, tables, ' +
  'code, links or emojis, and numbers, dates and times the way one says them. If the request ' +
  'needs your tools, use them as usual and then say the result briefly.]';

export function spokenQuestion(text: string): string {
  return `${SPOKEN_NOTE}\n\n${text}`;
}

// The model (and reasoning) agents answer spoken turns with, where the owner set one.
export async function voiceReplyModel(): Promise<{
  model: string;
  thinkingLevel: string | null;
} | null> {
  const settings = await readVoiceSettings();
  return settings.replyModel
    ? { model: settings.replyModel, thinkingLevel: settings.replyThinkingLevel }
    : null;
}
