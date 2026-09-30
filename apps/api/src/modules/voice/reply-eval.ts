import type { LocalAiEvalCaseResult, LocalAiEvalContext, LocalAiEvalResult } from '@helena/sdk';
import {
  HAND_OVER_TOOL,
  isTextHandOver,
  voiceReplyRequest,
  type VoiceReplyInput,
} from './reply-request';
import { otherLanguage } from './transcript';

// The eval of Helena's voice reply (class `voice-reply`, docs/helena-decisions/voice-2.md §4):
// the request is the voice reply's own (reply-request.ts), in German, on cases with a checkable
// answer. What matters most is that it never answers what only the agent can: a question about
// the owner's data or a request to do something must be handed over, every time. What the
// conversation answers it should answer itself — short, spoken, German, no Markdown.

type Case = {
  id: string;
  question: string;
  turns?: VoiceReplyInput['turns'];
} & ({ expect: 'hand-over' } | { expect: 'answer'; mustSay?: string[][]; maxWords?: number });

const NOW = 'Freitag, 26. September 2026 um 14:35';

export const VOICE_REPLY_THRESHOLD = 0.85;

const LONG_ANSWER =
  'Heute stehen drei Dinge an: Um zehn Uhr das Treffen mit dem Steuerberater, am Nachmittag ' +
  'die Freigabe der neuen Checkout-Seite für Verve und am Abend das Update des Servers. Die ' +
  'Freigabe wartet noch auf zwei Tests, und für das Server-Update ist ein Fenster von zehn ' +
  'Minuten eingeplant.';

export const VOICE_REPLY_CASES: Case[] = [
  // Answers from the conversation or general knowledge.
  { id: 'hello', question: 'Hallo, kannst du mich hören?', expect: 'answer', maxWords: 25 },
  { id: 'thanks', question: 'Danke, das war’s für heute.', expect: 'answer', maxWords: 25 },
  {
    id: 'time',
    question: 'Wie spät ist es gerade?',
    expect: 'answer',
    mustSay: [
      [
        '14:35',
        '14.35',
        '14 uhr 35',
        'vierzehn uhr fünfunddreißig',
        'fünf nach halb drei',
        '14 uhr',
      ],
    ],
  },
  {
    id: 'shorter',
    question: 'Kannst du das kürzer sagen?',
    turns: [
      { role: 'user', text: 'Was steht heute an?', mine: false },
      { role: 'assistant', text: LONG_ANSWER, mine: true },
    ],
    expect: 'answer',
    mustSay: [['steuerberater'], ['checkout', 'verve']],
    maxWords: 40,
  },
  {
    id: 'capital',
    question: 'Was ist eigentlich die Hauptstadt von Australien?',
    expect: 'answer',
    mustSay: [['canberra']],
  },
  { id: 'morning', question: 'Guten Morgen!', expect: 'answer', maxWords: 25 },
  // Only the agent can: the owner's data, anything to do, anything current.
  { id: 'tasks', question: 'Wie viele offene Aufgaben hat Verve gerade?', expect: 'hand-over' },
  {
    id: 'create',
    question: 'Erstelle bitte eine Aufgabe: Checkout-Seite testen.',
    expect: 'hand-over',
  },
  { id: 'mail', question: 'Schreib Anna eine Mail, dass ich später komme.', expect: 'hand-over' },
  { id: 'calendar', question: 'Was steht heute noch in meinem Kalender?', expect: 'hand-over' },
  { id: 'restart', question: 'Kannst du den Docker-Container neu starten?', expect: 'hand-over' },
  { id: 'yesterday', question: 'Was hat der Koordinator gestern erledigt?', expect: 'hand-over' },
  {
    id: 'remember',
    question: 'Merk dir, dass ich Kaffee ohne Zucker trinke.',
    expect: 'hand-over',
  },
  { id: 'weather', question: 'Wie wird das Wetter morgen in Hamburg?', expect: 'hand-over' },
  {
    id: 'follow-up',
    question: 'Und wann ist das Server-Update genau?',
    turns: [
      { role: 'user', text: 'Was steht heute an?', mine: false },
      {
        role: 'assistant',
        text: 'Drei Dinge: der Steuerberater, die Checkout-Freigabe und ein Server-Update.',
        mine: true,
      },
    ],
    // The time is not in the conversation: only the agent knows it.
    expect: 'hand-over',
  },
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}:.]+$/gu, ''))
    .filter(Boolean);
}

// Markdown a voice would read out: headings, lists, emphasis, tables, code.
const MARKDOWN = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s)|\*\*|__|`|\|/;

function judge(item: Case, text: string, handedOver: boolean): string | null {
  if (item.expect === 'hand-over') {
    if (handedOver) return null;
    return `answered instead of handing over: ${text.slice(0, 60)}`;
  }
  if (handedOver) return 'handed over what the conversation answers';
  const said = text.trim();
  if (!said) return 'said nothing';
  if (MARKDOWN.test(said)) return `markdown: ${said.slice(0, 60)}`;
  if (otherLanguage(said, 'de')) return `not German: ${said.slice(0, 60)}`;
  const count = words(said).length;
  if (count > (item.maxWords ?? 45)) return `too long (${count} words)`;
  const lower = said.toLowerCase();
  for (const alternatives of item.mustSay ?? []) {
    if (!alternatives.some((alternative) => lower.includes(alternative)))
      return `missing ${alternatives[0]}: ${said.slice(0, 60)}`;
  }
  return null;
}

export async function evaluateVoiceReply(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of VOICE_REPLY_CASES) {
    const answer = await context.chat(
      voiceReplyRequest({
        agentName: 'Home',
        personName: 'Patrick',
        now: NOW,
        language: 'de',
        turns: item.turns ?? [],
        question: item.question,
      }),
    );
    tokens += answer.outputTokens ?? 0;
    seconds += answer.latencyMs / 1000;
    const handedOver =
      answer.toolCalls.some((call) => call.name === HAND_OVER_TOOL) || isTextHandOver(answer.text);
    const detail = judge(item, answer.text, handedOver);
    cases.push({ id: item.id, passed: detail === null, detail, latencyMs: answer.latencyMs });
  }
  const latencies = cases.map((item) => item.latencyMs ?? 0).sort((a, b) => a - b);
  // Answering what only the agent knows is the one failure that must not happen: with any
  // hand-over case failed the class stays below its threshold, whatever the rest scored.
  const handOverFailed = VOICE_REPLY_CASES.some(
    (item, index) => item.expect === 'hand-over' && !cases[index]!.passed,
  );
  const share = cases.filter((item) => item.passed).length / cases.length;
  return {
    score: handOverFailed ? Math.min(share, VOICE_REPLY_THRESHOLD - 0.01) : share,
    cases,
    latencyMsP50: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
    tokensPerSecond: seconds > 0 ? tokens / seconds : null,
  };
}
