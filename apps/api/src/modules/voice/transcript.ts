// What Whisper answered, as the chat takes it (docs/helena-decisions/voice-2.md §2). Measured on
// Kingston (2026-09-26), three things turned the owner's words into nonsense:
//
// 1. Hallucinations on silence, breathing or a fan: Whisper was trained on subtitled video and
//    "hears" the credits of a subtitle file ("Untertitel im Auftrag des ZDF für funk, 2017",
//    "Thank you.", "Продолжение следует...") or repeats a syllable ("E aí E aí E aí"). 12 of 12
//    clips without speech came back as text on the NPU Whisper.
// 2. Another language although `de` was asked for: FastFlowLM's Whisper ignores `language` and
//    detects it itself, so a German sentence spoken unclearly came back as English or
//    Portuguese ("Fácil. É segura."). A transcript that is plainly not German when German was
//    asked for is not the owner's sentence.
// 3. Segments Whisper itself was unsure are speech at all: where the server reports them
//    (whisper.cpp's verbose_json), a segment with `no_speech_prob` > 0.6 and `avg_logprob` <
//    -1 is dropped — the rule OpenAI's own Whisper uses.
//
// A dropped transcript comes back empty with the reason, so the chat can say "nicht verstanden"
// instead of sending the owner something he did not say.

export type DropReason = 'no-speech' | 'hallucination' | 'other-language';

export interface JudgedTranscript {
  text: string;
  dropped: DropReason | null;
}

const WHOLE_LINE: RegExp[] = [
  // "Untertitel im Auftrag des ZDF, 2017", "Untertitelung des ZDF für funk 2017"
  /^untertitel(ung)?( im auftrag)? (des|der|von) (zdf|ard|wdr|swr|br|ndr|mdr|hr|rbb|sr|funk)\b/,
  // "Untertitel von Stephanie Geiges": a name, nothing else.
  /^untertitel(ung)? von [\p{L}-]+( [\p{L}-]+)?$/u,
  /\bamara\.org[ -]?community\b/,
  /^(copyright|©) (zdf|ard|wdr|swr|br|ndr|mdr|hr|rbb) \d{4}$/,
  /^(swr|zdf|ard|wdr|ndr) \d{4}$/,
  /^(vielen dank|danke) (fürs|für das|für ihre|für eure) (zu(schauen|sehen|hören)|aufmerksamkeit)$/,
  /^(thanks|thank you)( so much| very much)?( for watching)?$/,
  /^(please )?(like and )?subscribe( to (my|the|our) channel)?$/,
  /^(bye|you|so|okay bye)$/,
  /^sous-titr(age|es) /,
  /^продолжение следует/,
  /^редактор субтитров/,
];

// A sound label on its own: "[Musik]", "(Applaus)", "*lacht*", "♪♪".
const SOUND_LABEL = /^(\[[^\]]{1,40}\]|\([^)]{1,40}\)|\*[^*]{1,40}\*|[♪♫\s]+)$/;

// Lower case, without quotes and sentence punctuation; a dot inside a word (amara.org) stays.
function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[„“”"'’,!?…:;–—]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The same word or two over and over ("E aí E aí E aí E aí"): Whisper looping on noise.
function isLoop(plain: string): boolean {
  const words = plain.split(' ');
  if (words.length < 6) return false;
  for (const size of [1, 2, 3]) {
    const unit = words.slice(0, size).join(' ');
    let repeats = 0;
    for (let index = 0; index + size <= words.length; index += size) {
      if (words.slice(index, index + size).join(' ') === unit) repeats += 1;
    }
    if (repeats * size >= words.length * 0.8 && repeats >= 4) return true;
  }
  return false;
}

// Short function words: a German sentence has several, an English or Portuguese one has its own.
const FUNCTION_WORDS: Record<string, Set<string>> = {
  de: new Set(
    (
      'der die das den dem des ein eine einen einem einer und oder aber ist sind war bin bist ' +
      'hat habe haben ich du er sie es wir ihr mich dich mir dir uns nicht kein keine noch ' +
      'schon auch nur mal ja nein doch mit von zu zum zur im in am an auf für bei aus nach ' +
      'wie was wer wo wann warum wie viel viele kannst kann können soll sollst bitte danke ' +
      'mein meine dein deine gibt geht heute morgen jetzt dann hier da so sehr gut'
    ).split(' '),
  ),
  en: new Set(
    (
      'the a an and or but is are was were be been i you he she it we they me my your his ' +
      'her our their this that these those what which who whom how why when where not no ' +
      'do does did have has had will would can could should of to in on at for with from ' +
      'by as thank thanks please yes'
    ).split(' '),
  ),
  pt: new Set(
    'o a os as um uma e é que não de da do em para com por se mas fácil segura isso'.split(' '),
  ),
  es: new Set('el la los las un una y es que no de del en para con por pero muy'.split(' ')),
};

// Whether a transcript that should be German plainly is another language: at least three
// words, hardly a German function word, and clearly more of another language's.
export function otherLanguage(text: string, language: string | null): boolean {
  if (language !== 'de') return false;
  const words = normalized(text)
    .split(' ')
    .map((word) => word.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (words.length < 3) return false;
  // A word both languages have ("was", "in", "so") says nothing.
  const german = FUNCTION_WORDS.de!;
  const others = ['en', 'pt', 'es'].map((lang) => FUNCTION_WORDS[lang]!);
  const own = words.filter(
    (word) => german.has(word) && !others.some((set) => set.has(word)),
  ).length;
  const other = Math.max(
    ...others.map((set) => words.filter((word) => set.has(word) && !german.has(word)).length),
  );
  return own / words.length < 0.15 && other >= 2 && other > own * 2;
}

// Whisper's own confidence per segment, where the server reports it (verbose_json).
export interface TranscriptSegment {
  text: string;
  noSpeechProb: number | null;
  avgLogprob: number | null;
}

export function confidentText(segments: TranscriptSegment[]): string {
  return segments
    .filter(
      (segment) =>
        !(
          segment.noSpeechProb !== null &&
          segment.avgLogprob !== null &&
          segment.noSpeechProb > 0.6 &&
          segment.avgLogprob < -1
        ),
    )
    .map((segment) => segment.text)
    .join(' ');
}

export function judgeTranscript(
  raw: string,
  options: { language?: string | null; maxLength?: number } = {},
): JudgedTranscript {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', dropped: 'no-speech' };
  if (SOUND_LABEL.test(text)) return { text: '', dropped: 'no-speech' };
  const plain = normalized(text);
  if (!plain) return { text: '', dropped: 'no-speech' };
  if (WHOLE_LINE.some((pattern) => pattern.test(plain)) || isLoop(plain))
    return { text: '', dropped: 'hallucination' };
  if (otherLanguage(text, options.language ?? null)) return { text: '', dropped: 'other-language' };
  return { text: text.slice(0, options.maxLength ?? 10_000), dropped: null };
}

// The transcript to insert or send, trimmed; '' when there was nothing but a hallucinated
// subtitle line, a sound label or silence.
export function cleanTranscript(raw: string, maxLength = 10_000): string {
  return judgeTranscript(raw, { maxLength }).text;
}
