import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestVoice } from './voicePick';

const voice = (name: string, lang: string, localService = true, isDefault = false) => ({
  name,
  lang,
  localService,
  default: isDefault,
});

describe('bestVoice', () => {
  it('takes the most natural local voice of the language', () => {
    const voices = [
      voice('Flo (Deutsch (Deutschland))', 'de-DE'),
      voice('Anna', 'de-DE'),
      voice('Anna (Premium)', 'de-DE'),
      voice('Google Deutsch', 'de-DE', false),
      voice('Samantha', 'en-US', true, true),
    ];
    assert.equal(bestVoice(voices, 'de-DE')?.name, 'Anna (Premium)');
  });

  it('never picks a novelty voice while another speaks the language', () => {
    const voices = [
      voice('Grandpa (Deutsch)', 'de-DE'),
      voice('Eddy (Deutsch)', 'de-DE'),
      voice('Anna', 'de-DE'),
    ];
    assert.equal(bestVoice(voices, 'de-DE')?.name, 'Anna');
  });

  it('prefers the device over an online voice, and falls back to the language', () => {
    assert.equal(
      bestVoice([voice('Google Deutsch', 'de-DE', false), voice('Helena', 'de-AT')], 'de-DE')?.name,
      'Helena',
    );
    assert.equal(
      bestVoice([voice('Google Deutsch', 'de-DE', false)], 'de-DE')?.name,
      'Google Deutsch',
    );
    assert.equal(bestVoice([voice('Samantha', 'en-US')], 'de-DE'), undefined);
  });
});
