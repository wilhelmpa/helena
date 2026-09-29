import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { speechText } from './speechText';

describe('speechText', () => {
  it('drops code blocks and keeps link text', () => {
    assert.equal(
      speechText('Siehe [die Doku](https://x.y).\n\n```ts\nconst a = 1;\n```\nFertig.'),
      'Siehe die Doku.\n\n \nFertig.',
    );
  });

  it('removes list markers, headings and emphasis', () => {
    assert.equal(speechText('# Titel\n- **eins**\n- _zwei_\n1. drei'), 'Titel\neins\nzwei\ndrei');
  });

  it('keeps inline code as plain words', () => {
    assert.equal(speechText('Nutze `bun test` dafür.'), 'Nutze bun test dafür.');
  });

  it('speaks the name Ava as Eywa without changing longer words', () => {
    assert.equal(speechText('Ava, Avatare und AVA.'), 'Eywa, Avatare und Eywa.');
  });
});
