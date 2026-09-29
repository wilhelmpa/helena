import { describe, expect, it } from 'bun:test';
import { germanNumber, ttsText } from '../../tts-text';

describe('German TTS text', () => {
  it('speaks integers and decimal values', () => {
    expect(germanNumber(2026)).toBe('zweitausendsechsundzwanzig');
    expect(ttsText('Das sind 1.250,5 kg und 12,5 %.')).toBe(
      'Das sind eintausendzweihundertfünfzig Komma fünf Kilogramm und zwölf Komma fünf Prozent.',
    );
  });

  it('speaks dates, times, money and abbreviations', () => {
    expect(ttsText('Am 29.09.2026 um 14:05: ca. 12,50 € für die GmbH.')).toBe(
      'Am neunundzwanzigsten September zweitausendsechsundzwanzig um vierzehn Uhr fünf: circa zwölf Euro und fünfzig Cent für die Gesellschaft mit beschränkter Haftung.',
    );
    expect(ttsText('z. B. KI und API')).toBe('zum Beispiel künstliche Intelligenz und A P I');
  });

  it('removes markup, code, urls and emojis', () => {
    expect(
      ttsText(
        '# Ergebnis\n- **Gut** ✅ [siehe hier](https://example.com)\n```js\nconst x = 1\n```',
      ),
    ).toBe('Ergebnis Gut siehe hier');
  });

  it('uses the English pronunciation lexicon with phrase priority and overrides', () => {
    expect(ttsText('Paper Trading, Paperclip und ein Pull Request auf GitHub.')).toBe(
      'Peiper Treiding, Peiperklipp und ein Pull Rikwäst auf Gitt Hab.',
    );
    expect(ttsText('Claude trifft Codex.', [{ word: 'Claude', pronunciation: 'Kloud' }])).toBe(
      'Kloud trifft Kohdeks.',
    );
    expect(ttsText('Cloudflare und CloudflareX.')).toBe('Klaudflär und CloudflareX.');
  });
});
