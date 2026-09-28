import { describe, expect, it } from 'bun:test';
import { limitedPcm } from '../../service';
import {
  correctVocabulary,
  normalizeVoiceSettings,
  suggestedAliases,
  vocabularyPrompt,
} from '../../settings';
import { confidentText, judgeTranscript, otherLanguage } from '../../transcript';
import {
  HAND_OVER_TOOL,
  committed,
  parseStreamLine,
  voiceReplyNow,
  voiceReplyRequest,
} from '../../reply-request';
import { VOICE_REPLY_CASES } from '../../reply-eval';

describe('judgeTranscript', () => {
  // What the NPU Whisper answered on Kingston (2026-09-26) with `language=de` asked for.
  it('drops another language when German was asked for', () => {
    for (const heard of [
      'Was that huge budget line on Canada?',
      'is coming to the end. Fácil. É segura.',
      'Can students contain a new start?',
      'Thank you, that was for you.',
    ]) {
      expect(judgeTranscript(heard, { language: 'de' }).dropped).toBe('other-language');
    }
  });

  it('keeps German, also with English words and short answers', () => {
    for (const said of [
      'Wie viele offene Pull Requests gibt es im Repository?',
      'Frag Claude Code, ob die Tests grün sind.',
      'Stopp, das reicht.',
      'Was ist das?',
      'Ja',
      'Okay, deploy das Backend-Update.',
    ]) {
      expect(judgeTranscript(said, { language: 'de' })).toEqual({ text: said, dropped: null });
    }
    // Only German is checked: other languages pass as they come.
    expect(otherLanguage('the deploy of the server', 'en')).toBe(false);
  });

  it('drops what Whisper invents on silence and noise', () => {
    for (const heard of [
      'Thank you.',
      'Продолжение следует...',
      'E aí E aí E aí E aí E aí E aí E aí E',
      'Untertitel von Stephanie Geiges',
      'Vielen Dank für Ihre Aufmerksamkeit.',
    ]) {
      expect(judgeTranscript(heard, { language: 'de' }).dropped).toBe('hallucination');
    }
    expect(judgeTranscript('  ', {}).dropped).toBe('no-speech');
    expect(judgeTranscript('[Musik]', {}).dropped).toBe('no-speech');
  });

  it('keeps only the segments Whisper is sure are speech', () => {
    expect(
      confidentText([
        { text: 'Hallo.', noSpeechProb: 0.02, avgLogprob: -0.3 },
        { text: ' Thank you.', noSpeechProb: 0.8, avgLogprob: -1.2 },
        { text: ' Tschüss.', noSpeechProb: null, avgLogprob: null },
      ]),
    ).toBe('Hallo.  Tschüss.');
  });
});

describe('voice settings', () => {
  it('keeps values in range and words once', () => {
    expect(
      normalizeVoiceSettings({
        pauseMs: 20,
        speed: 3,
        vocabulary: ['Verve', 'verve', '', 'x'.repeat(80)],
        voice: '  ',
        replyThinkingLevel: 'low',
      }),
    ).toEqual({
      pauseMs: 300,
      speed: 1.4,
      vocabulary: ['Verve', 'x'.repeat(60)],
      vocabularyAliases: null,
      voice: null,
      replyModel: null,
      // No reasoning without a model.
      replyThinkingLevel: null,
    });
    expect(normalizeVoiceSettings(null).pauseMs).toBe(600);
  });

  it('puts the owner’s words before Helena’s', () => {
    expect(vocabularyPrompt(['Müller'], ['Helena', 'müller', 'Verve'])).toBe(
      'Müller, Helena, TRADE, VERVE, Jev, Qwen, Alpaca.',
    );
    expect(vocabularyPrompt([], [])).toBe('Helena, TRADE, VERVE, Jev, Qwen, Alpaca.');
  });

  it('corrects only complete names and allows editing the defaults', () => {
    const defaults = suggestedAliases(['Jev', 'VERVE', 'TRADE']);
    expect(correctVocabulary('Jeff und Färfe, Ferfe, Verve und Trade.', defaults)).toBe(
      'Jev und VERVE, VERVE, VERVE und TRADE.',
    );
    expect(correctVocabulary('Jefferson, Verveprojekt und Trader handeln.', defaults)).toBe(
      'Jefferson, Verveprojekt und Trader handeln.',
    );
    expect(suggestedAliases(['Jev', 'Verve', 'Trading'])).toEqual([
      { heard: 'Jeff', written: 'Jev' },
    ]);
    expect(
      normalizeVoiceSettings({ vocabularyAliases: [{ heard: 'Planet', written: 'plane' }] })
        .vocabularyAliases,
    ).toEqual([{ heard: 'Planet', written: 'plane' }]);
  });
});

describe('limitedPcm', () => {
  async function read(stream: ReadableStream<Uint8Array>) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return chunks;
  }
  const source = (parts: number[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of parts) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });

  it('passes whole samples only', async () => {
    const chunks = await read(limitedPcm(source([3, 5, 2]), 1_000));
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([2, 6, 2]);
  });

  it('stops past the limit', async () => {
    await expect(read(limitedPcm(source([600, 600]), 1_000))).rejects.toThrow('too large');
  });
});

describe('the voice reply request', () => {
  const request = voiceReplyRequest({
    agentName: 'Home',
    personName: 'Patrick',
    now: 'Freitag, 26. September 2026 um 14:35',
    language: 'de',
    turns: [
      { role: 'user', text: 'Was steht an?', mine: false },
      { role: 'assistant', text: 'Drei Dinge.', mine: true },
    ],
    question: 'Sag das kürzer.',
  });

  it('offers nothing but the hand-over, and reads the conversation', () => {
    expect(request.tools?.map((tool) => tool.name)).toEqual([HAND_OVER_TOOL]);
    expect(request.thinking).toBe('off');
    expect(request.system).toContain('14:35');
    expect(request.system).toContain('German');
    expect(request.prompt).toBe(
      'The conversation so far:\nPerson: Was steht an?\nYou: Drei Dinge.\n\n' +
        'The person says now: Sag das kürzer.',
    );
  });

  it('commits to text once it is a sentence or long enough', () => {
    expect(committed('Ja')).toBe(false);
    expect(committed('Ja, ich höre dich.')).toBe(true);
    expect(committed('a'.repeat(60))).toBe(true);
  });

  it('reads the lines of a chat-completions stream', () => {
    expect(parseStreamLine('data: [DONE]')).toBe('done');
    expect(parseStreamLine(': keep-alive')).toBeNull();
    expect(parseStreamLine('data: {"choices":[{"delta":{"content":"Ja"}}]}')).toEqual({
      content: 'Ja',
      toolCall: false,
      usage: null,
    });
    expect(
      parseStreamLine('data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}'),
    ).toMatchObject({ toolCall: true });
  });

  it('says the time the way the person reads it', () => {
    const date = new Date('2026-09-26T12:35:00Z');
    expect(voiceReplyNow('de', date)).toContain('26. September 2026');
  });

  it('has an eval that insists on handing over', () => {
    const handOvers = VOICE_REPLY_CASES.filter((item) => item.expect === 'hand-over');
    expect(handOvers.length).toBeGreaterThanOrEqual(8);
  });
});
