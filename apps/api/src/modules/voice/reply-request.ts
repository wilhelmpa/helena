import type { LocalAiChatRequest } from '@helena/sdk';

// The request of Helena's voice reply (class `voice-reply`, reply.ts) and the pure pieces of
// reading its stream: kept apart so the class's eval (reply-eval.ts) asks the model exactly
// what the voice reply asks, without the chat and the database.

export const VOICE_REPLY_CLASS = 'voice-reply';

const MAX_TOKENS = 200;
// The turns of the conversation the model reads, and how much of each.
const HISTORY_TURNS = 10;
const TURN_CHARS = 1_200;
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
    `You are ${input.agentName}, an assistant in ${input.displayName ?? 'Helena'}. You are talking with ${person} by ` +
      'voice: everything you write is read aloud at once.',
    'Answer yourself ONLY when this conversation and general knowledge are enough: a greeting, ' +
      'small talk, whether you can hear them, thanks or goodbye, the time or the date (it is ' +
      `${input.now}), a general-knowledge question, or repeating, shortening or explaining ` +
      'something already said in this conversation.',
    `For everything else call ${HAND_OVER_TOOL} at once, without writing anything first: ` +
      'anything about their tasks, projects, mails, calendar, files, notes, agents, servers ' +
      'or other data you cannot see here; anything that should be done (create, change, send, ' +
      'start, stop, delete, search, look up, remember); anything current (news, weather, ' +
      'prices); anything you are not sure about. Never guess and never promise to do ' +
      'something yourself.',
    'If you are about to say that you will check, look, open, search, send, note or do ' +
      'something ("I will look at your calendar", "one moment, I will check"), that is a ' +
      `hand-over: call ${HAND_OVER_TOOL} instead and write nothing. The agent tells the person ` +
      'what it found.',
    `When you answer: ${language}, one or two short spoken sentences, no Markdown, no lists, ` +
      'no emojis.',
  ].join('\n\n');
  const earlier = input.turns.slice(-HISTORY_TURNS).map((turn) => {
    const speaker = turn.role === 'user' ? 'Person' : turn.mine ? 'You' : 'Another agent';
    return `${speaker}: ${turn.text.replace(/\s+/g, ' ').trim().slice(0, TURN_CHARS)}`;
  });
  const prompt = [
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

// Whether held-back text is clearly an answer: a finished sentence, or long enough.
export function committed(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= COMMIT_CHARS || /[.!?…](["“”'’)»]*)\s*$/u.test(trimmed);
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
