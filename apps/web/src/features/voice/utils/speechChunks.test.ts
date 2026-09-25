import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextSpeechChunks } from './speechChunks';

// Reads a text the way the conversation mode does while an answer streams: the text grows in
// steps, each step hands over what is complete, and the end hands over the rest.
function readInSteps(steps: string[]): string[] {
  const spoken: string[] = [];
  let offset = 0;
  steps.forEach((text, index) => {
    const next = nextSpeechChunks(text, offset, index === steps.length - 1);
    spoken.push(...next.chunks);
    offset = next.offset;
  });
  return spoken;
}

describe('nextSpeechChunks', () => {
  it('hands over a sentence once the space after it has arrived', () => {
    assert.deepEqual(nextSpeechChunks('Hallo Owner. Wie geht', 0, false), {
      chunks: ['Hallo Owner.'],
      offset: 12,
    });
    // The dot alone is not enough: "helena.de" could follow.
    assert.deepEqual(nextSpeechChunks('Hallo Owner.', 0, false), { chunks: [], offset: 0 });
    assert.deepEqual(nextSpeechChunks('Hallo Owner.', 0, true), {
      chunks: ['Hallo Owner.'],
      offset: 12,
    });
  });

  it('reads a streamed answer once, in order, and nothing twice', () => {
    const full = 'Guten Morgen! Heute stehen drei Dinge an. Zuerst der Launch?! Dann die Mails.';
    const steps = [10, 20, 35, 50, 62, full.length].map((end) => full.slice(0, end));
    assert.deepEqual(readInSteps(steps), [
      'Guten Morgen!',
      'Heute stehen drei Dinge an.',
      'Zuerst der Launch?!',
      'Dann die Mails.',
    ]);
  });

  it('does not end a sentence after an abbreviation, an ordinal or an initial', () => {
    assert.deepEqual(
      nextSpeechChunks('Das ist z. B. am 3. Oktober bei Dr. Weber fällig. Danach', 0, false).chunks,
      ['Das ist z. B. am 3. Oktober bei Dr. Weber fällig.'],
    );
  });

  it('skips code blocks whole and waits while one is still open', () => {
    const answer = 'Hier ist der Code dazu:\n```ts\nconst a = 1;\n```\nDanach ist alles fertig.';
    assert.deepEqual(nextSpeechChunks(answer, 0, true).chunks, [
      'Hier ist der Code dazu:',
      'Danach ist alles fertig.',
    ]);
    const open = 'Hier ist der Code dazu:\n```ts\nconst a = 1; // Wichtig. Ja.\n';
    const first = nextSpeechChunks(open, 0, false);
    assert.deepEqual(first.chunks, ['Hier ist der Code dazu:']);
    // Nothing inside the open block is read, however much of it arrives.
    assert.deepEqual(nextSpeechChunks(`${open}more. code.\n`, first.offset, false).chunks, []);
    // A line that may still become a fence waits too.
    assert.deepEqual(nextSpeechChunks('Erst das hier.\n``', 0, false).chunks, ['Erst das hier.']);
  });

  it('reads Markdown as words: lists, headings, links, emphasis', () => {
    const answer =
      '## Plan\n\n- **Landingpage** fertig\n- Checkout im Test\n\nMehr unter [DEV-12](/x).';
    assert.deepEqual(nextSpeechChunks(answer, 0, true).chunks, [
      'Plan, Landingpage fertig',
      'Checkout im Test',
      'Mehr unter DEV-12.',
    ]);
  });

  it('joins pieces too short to say alone', () => {
    assert.deepEqual(nextSpeechChunks('Ja. Nein. Vielleicht doch.', 0, true).chunks, [
      'Ja. Nein. Vielleicht doch.',
    ]);
    // While streaming, a short piece waits for the next one.
    assert.deepEqual(nextSpeechChunks('Ja. Und', 0, false), { chunks: [], offset: 0 });
  });

  it('cuts a very long sentence at a comma', () => {
    const long = `${'Das ist ein sehr langer Satz ohne Ende, '.repeat(12)}der endlich endet.`;
    const chunks = nextSpeechChunks(long, 0, true).chunks;
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 280));
    assert.equal(chunks.join(' '), long);
  });

  it('says nothing for an answer that is only code', () => {
    assert.deepEqual(nextSpeechChunks('```\nls -la\n```', 0, true), {
      chunks: [],
      offset: 14,
    });
  });
});
