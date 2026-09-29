import { readVoiceSettings } from './settings';

// Spoken turns of a chat (docs/helena-decisions/voice-2.md §4): what the conversation mode
// sends is read by the agent like a typed message, with a note that its answer will be heard,
// not read. Without it agents answered a spoken "Wie viele Aufgaben sind offen?" with a table.

const SPOKEN_NOTE =
  '[Said in a voice conversation. Answer briefly in natural spoken language. If the person ' +
  'needs detailed content, a list, table or code, put the complete content in this chat; the ' +
  'voice client will say a short notice instead. Use your tools as usual and give a brief ' +
  'spoken result when they finish. Say numbers, dates and times naturally.]';

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
