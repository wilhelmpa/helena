import assert from 'node:assert/strict';
import { it } from 'node:test';
import { BRIDGES, preloadedPhrases, spokenLanguage, toolUpdate } from './voicePhrases';
it('uses translated bridges and progress phrases for all ten page languages', () => {
  const expected = {
    de: 'Ich schau kurz nach.',
    en: "I'll check that for you.",
    ar: 'سأتحقق من ذلك.',
    es: 'Voy a comprobarlo.',
    fr: 'Je vais vérifier.',
    it: 'Controllo subito.',
    ja: '少し確認します。',
    pt: 'Vou verificar.',
    ru: 'Сейчас проверю.',
    zh: '我查一下。',
  };
  assert.deepEqual(Object.keys(BRIDGES).sort(), Object.keys(expected).sort());
  for (const [lang, first] of Object.entries(expected)) {
    assert.equal(spokenLanguage(lang), lang);
    assert.equal(preloadedPhrases(lang)[0], first);
    assert.ok(toolUpdate('shell', lang).length > 0);
    if (lang !== 'en') assert.notEqual(toolUpdate('shell', lang), toolUpdate('shell', 'en'));
  }
});
