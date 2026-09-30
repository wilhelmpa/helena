import { describe, expect, it } from 'bun:test';
import type { LocalAiEvalContext } from '@helena/sdk';
import { committed, HAND_OVER_TOOL, isTextHandOver } from '../../reply-request';
import { evaluateVoiceReply, VOICE_REPLY_CASES, VOICE_REPLY_THRESHOLD } from '../../reply-eval';

const MARKERS = [
  'hand_to_agent',
  'Hand_to_agent',
  ' HAND_TO_AGENT. \n',
  '\t“hand_to_agent”?!',
  '(hand_to_agent)',
  'hand_to_agent' + ' '.repeat(70),
];

const SENTENCES = [
  'Ich rufe hand_to_agent auf.',
  'hand_to_agent ist ein Werkzeug.',
  'hand_to_agent. Ich gebe das weiter.',
  'Bitte: hand_to_agent',
  'hand_to_agent2',
  'hand to agent',
  '',
  '  ...  ',
];

describe('text hand-over', () => {
  it('accepts only the tool name with surrounding punctuation and whitespace', () => {
    for (const marker of MARKERS) expect(isTextHandOver(marker)).toBe(true);
    for (const sentence of SENTENCES) expect(isTextHandOver(sentence)).toBe(false);
  });

  it('holds every stream prefix of a marker, including punctuation and long whitespace', () => {
    for (const marker of MARKERS) {
      for (let length = 1; length <= marker.length; length++)
        expect(committed(marker.slice(0, length))).toBe(false);
    }
    expect(committed('hand_to_agent. Ich gebe das weiter.')).toBe(true);
    expect(committed('Ich rufe hand_to_agent auf.')).toBe(true);
    expect(committed('Ja, ich höre dich.')).toBe(true);
    expect(committed('a'.repeat(60))).toBe(true);
  });
});

function contextFor(handOverText: string, toolCall = false): LocalAiEvalContext {
  let index = 0;
  const answers: Record<string, string> = {
    hello: 'Ja, ich höre dich.',
    thanks: 'Gern, bis bald.',
    time: 'Es ist 14:35 Uhr.',
    shorter: 'Heute stehen der Steuerberater und die Checkout-Freigabe an.',
    capital: 'Canberra ist die Hauptstadt Australiens.',
    morning: 'Guten Morgen.',
  };
  return {
    model: 'test',
    async chat() {
      const item = VOICE_REPLY_CASES[index++]!;
      const handOver = item.expect === 'hand-over';
      return {
        text: handOver ? handOverText : answers[item.id]!,
        toolCalls: handOver && toolCall ? [{ name: HAND_OVER_TOOL, arguments: '{}' }] : [],
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      };
    },
    async embed() {
      return { vectors: [], latencyMs: 1 };
    },
  };
}

describe('voice reply eval', () => {
  it('scores text markers exactly like tool hand-overs', async () => {
    const tools = await evaluateVoiceReply(contextFor('', true));
    expect(tools.score).toBe(1);
    for (const marker of MARKERS) {
      const text = await evaluateVoiceReply(contextFor(marker));
      expect(text).toEqual(tools);
    }
  });

  it('keeps sentences containing the tool name below the unchanged threshold', async () => {
    for (const sentence of SENTENCES) {
      const result = await evaluateVoiceReply(contextFor(sentence));
      expect(result.score).toBeLessThan(VOICE_REPLY_THRESHOLD);
      expect(result.cases.find((item) => item.id === 'tasks')?.passed).toBe(false);
    }
  });

  it('rejects a marker for a question that should be answered', async () => {
    const context = contextFor('hand_to_agent');
    const chat = context.chat;
    context.chat = async (request) => ({ ...(await chat(request)), text: 'HAND_TO_AGENT.' });
    const result = await evaluateVoiceReply(context);
    expect(result.cases.find((item) => item.id === 'hello')?.passed).toBe(false);
    expect(result.score).toBeLessThan(VOICE_REPLY_THRESHOLD);
  });
});
