import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classModelLabel, modelLabel, prettyModelId } from './modelLabels';

const words = {
  localDefault: 'Lokales Standardmodell',
  local: 'lokal',
  configured: 'eingestellte Stimme',
};

describe('Modellnamen in der Matrix', () => {
  test('Modell-IDs werden lesbar, nie als helena-…/… gezeigt', () => {
    assert.equal(modelLabel('volition-local-default', words), 'Lokales Standardmodell');
    assert.equal(modelLabel('helena-halogen/halogen-qwen3.8-flash-next', words), 'Flash (lokal)');
    assert.equal(modelLabel('gpt-6-sol', words), 'GPT-6 Sol');
    assert.equal(modelLabel('claude-opus-5-5', words), 'Claude Opus 5.5');
    assert.equal(prettyModelId('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
    assert.equal(prettyModelId('helena-lemonade/Qwen3.8-27B-GGUF'), 'Qwen3.8 27B');
  });

  test('ein Name aus dem Katalog gewinnt, außer er ist selbst eine lokale ID', () => {
    const names = new Map([
      ['gpt-6-luna', 'GPT-6 Luna'],
      ['helena-halogen/x', 'helena-halogen/x'],
    ]);
    assert.equal(modelLabel('gpt-6-luna', words, names), 'GPT-6 Luna');
    assert.doesNotMatch(modelLabel('helena-halogen/x', words, names), /helena-/);
  });

  test('Aufgabenklassen nennen ihre Modelle in Worten', () => {
    const cw = { ...words };
    assert.equal(classModelLabel('jev-1.13.0', cw), 'Jev');
    assert.equal(classModelLabel('qwen3.5:2b', cw), 'Qwen3.5 2B');
    assert.equal(classModelLabel('Qwen3-Embedding-0.6B', cw), 'Qwen3 Embedding 0.6B');
    assert.equal(classModelLabel('embed-gemma:300m', cw), 'EmbeddingGemma 300M');
    assert.equal(classModelLabel('configured-tts', cw), 'eingestellte Stimme');
    assert.equal(classModelLabel('whisper', cw), 'Whisper');
  });
});
