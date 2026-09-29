import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRecognizedName } from './speechRecognition';

test('browser recognition writes the name Ava from pronunciation variants', () => {
  assert.equal(
    normalizeRecognizedName('Eywa, Ewa, Aiwa und Ava. Ewagen bleibt.'),
    'Ava, Ava, Ava und Ava. Ewagen bleibt.',
  );
});
