import type { LocalAiChatRequest } from '@helena/sdk';

// The request of Helena's voice reply (class `voice-reply`, reply.ts) and the pure pieces of
// reading its stream: kept apart so the class's eval (reply-eval.ts) asks the model exactly
// what the voice reply asks, without the chat and the database.

export const VOICE_REPLY_CLASS = 'voice-reply';

const MAX_TOKENS = 128;
// The turns of the conversation the model reads, and how much of each.
const HISTORY_TURNS = 4;
const TURN_CHARS = 500;
// Text is held back until it is clearly an answer (a sentence, or this much): a model that
// starts writing and then calls the hand-over has said nothing yet.
const COMMIT_CHARS = 60;

export const HAND_OVER_TOOL = 'hand_to_agent';

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ar: 'Arabic',
  ja: 'Japanese',
  ru: 'Russian',
  zh: 'Chinese',
};

export interface VoiceReplyInput {
  agentName: string;
  displayName?: string;
  personName: string | null;
  // "Freitag, 26. September 2026, 00:43" in the person's language.
  now: string;
  language: string;
  turns: { role: 'user' | 'assistant'; text: string; mine: boolean }[];
  question: string;
}

// The request the voice reply sends — and its eval, word for word.
export function voiceReplyRequest(input: VoiceReplyInput): LocalAiChatRequest {
  const language = LANGUAGE_NAMES[input.language] ?? 'German';
  const person = input.personName ?? 'the person';
  const system = [
    `You are ${input.agentName}, an assistant in ${input.displayName ?? 'Ava'}, speaking with ${person}. ` +
      'Your streamed answer is read aloud immediately.',
    'Answer greetings, thanks, goodbye, whether you hear them, the supplied local time/date, ' +
      'and stable general knowledge. Repeat, shorten or explain earlier answers using only ' +
      'their supplied facts, including facts about tasks, projects, mail, calendars or servers.',
    `Otherwise call ${HAND_OVER_TOOL} immediately with no text: actions (create, change, send, ` +
      'start, stop, delete, search, remember), unseen data (tasks, projects, mail, calendar, ' +
      'files, agents, servers), current news/weather/prices, or uncertainty. Answer a data ' +
      'question only if the conversation supplies the exact requested detail; mentioning ' +
      'a topic supplies no missing details. Never guess or promise to check or act: hand over.',
    `Answer in ${language}, one or two short spoken sentences, no Markdown, lists or emojis.`,
  ].join('\n\n');
  const earlier = input.turns.slice(-HISTORY_TURNS).map((turn) => {
    const speaker = turn.role === 'user' ? 'Person' : turn.mine ? 'You' : 'Another agent';
    return `${speaker}: ${turn.text.replace(/\s+/g, ' ').trim().slice(0, TURN_CHARS)}`;
  });
  const prompt = [
    `Current local date and time: ${input.now}`,
    ...(earlier.length ? ['The conversation so far:', ...earlier, ''] : []),
    `The person says now: ${input.question}`,
  ].join('\n');
  return {
    system,
    prompt,
    maxTokens: MAX_TOKENS,
    thinking: 'off',
    tools: [
      {
        name: HAND_OVER_TOOL,
        description:
          `Hand this turn to ${input.agentName}'s full agent, which has the tools and the ` +
          "person's data and answers a moment later.",
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
  };
}

export function voiceReplyNow(
  language: string,
  date = new Date(),
  timeZone = 'Europe/Berlin',
): string {
  const locale = language === 'de' ? 'de-DE' : language;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function isTextHandOver(text: string): boolean {
  return /^[\s\p{P}]*hand_to_agent[\s\p{P}]*$/iu.test(text);
}

function couldBeTextHandOver(text: string): boolean {
  const name = text.replace(/^[\s\p{P}]+/u, '').toLowerCase();
  return HAND_OVER_TOOL.startsWith(name) || isTextHandOver(text);
}

// A possible hand-over stays held until the stream ends.
export function committed(text: string): boolean {
  if (couldBeTextHandOver(text)) return false;
  const trimmed = text.trim();
  return trimmed.length >= COMMIT_CHARS || /[.!?…。！？؟](["“”'’)»]*)\s*$/u.test(trimmed);
}

export interface StreamDelta {
  content: string;
  toolCall: boolean;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

// One `data:` line of an OpenAI chat-completions stream.
export function parseStreamLine(line: string): StreamDelta | 'done' | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return 'done';
  let body: {
    choices?: { delta?: { content?: string | null; tool_calls?: unknown[] } }[];
    usage?: StreamDelta['usage'];
  };
  try {
    body = JSON.parse(data);
  } catch {
    return null;
  }
  const delta = body.choices?.[0]?.delta;
  return {
    content: typeof delta?.content === 'string' ? delta.content : '',
    toolCall: Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0,
    usage: body.usage ?? null,
  };
}
