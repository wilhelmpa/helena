// A piece of an answer as a voice should say it (docs/helena-decisions/voice-2.md §3): what a
// text abbreviates or writes as a symbol, spelled out, so neither the browser's voice nor
// Helena's local one reads "z. B." as "z b" or "VOL-42" as "vol minus zweiundvierzig". Emojis
// are dropped, a link is said as its site. German is spelled out fully; other languages get the
// symbols and links.

const GERMAN: [RegExp, string][] = [
  [/\bz\.\s?B\./g, 'zum Beispiel'],
  [/\bd\.\s?h\./g, 'das heißt'],
  [/\bu\.\s?a\./g, 'unter anderem'],
  [/\bu\.\s?U\./g, 'unter Umständen'],
  [/\bo\.\s?Ä\./g, 'oder Ähnliches'],
  [/\bbzw\./g, 'beziehungsweise'],
  [/\bca\./g, 'circa'],
  [/\busw\./g, 'und so weiter'],
  [/\bggf\./g, 'gegebenenfalls'],
  [/\binkl\./g, 'inklusive'],
  [/\bevtl\./g, 'eventuell'],
  [/\bvgl\./g, 'vergleiche'],
  [/\bNr\.\s?(?=\d)/g, 'Nummer '],
  [/\bDr\.\s?/g, 'Doktor '],
  [/\bProf\.\s?/g, 'Professor '],
  [/\bMio\./g, 'Millionen'],
  [/\bMrd\./g, 'Milliarden'],
  [/\s?%/g, ' Prozent'],
  [/\s?€/g, ' Euro'],
  [/\s&\s/g, ' und '],
];

const ENGLISH: [RegExp, string][] = [
  [/\be\.g\./gi, 'for example'],
  [/\bi\.e\./gi, 'that is'],
  [/\betc\./gi, 'et cetera'],
  [/\s?%/g, ' percent'],
  [/\s&\s/g, ' and '],
];

export function speakable(text: string, lang = 'de'): string {
  let out = text
    // A link is said as its site: "volition.one" rather than the whole address.
    .replace(/\bhttps?:\/\/(?:www\.)?([^\s/?#]+)[^\s]*/gi, '$1')
    // Task keys: "VOL-42" as "VOL 42".
    .replace(/\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g, '$1 $2')
    .replace(/\s?(→|->|=>)\s?/g, ', ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}]+/gu, '');
  for (const [pattern, words] of lang.startsWith('de')
    ? GERMAN
    : lang.startsWith('en')
      ? ENGLISH
      : []) {
    out = out.replace(pattern, words);
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}
