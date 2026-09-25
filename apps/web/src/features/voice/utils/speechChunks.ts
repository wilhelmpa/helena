import { speechText } from './speechText';

// Reading an answer aloud while it streams: the text that has arrived is cut into pieces a
// voice can say — whole sentences, list items, lines — as soon as each is complete, so the
// first sentence is spoken while the agent still writes the rest. Code blocks are skipped
// whole (speechText drops them); a very long sentence is cut at a comma so no single piece
// runs longer than a voice engine handles well (Chrome's own voices stop after ~15 seconds).

// Where reading stopped: everything before `offset` has been handed to the voice.
export interface SpeechChunks {
  chunks: string[];
  offset: number;
}

// Words after which a dot does not end the sentence (German and English).
const ABBREVIATION = new Set(
  (
    'z u d o s v bzw ca etc evtl ggf inkl max min mind nr dr prof hr fr str vgl bspw sog usw ' +
    'abs abt allg bd bsp chr dt eigtl einschl entspr erg gem ggü hrsg jh jhd lt mio mrd ' +
    'e i eg ie vs mr mrs ms no st jan feb mär apr jun jul aug sep sept okt oct nov dez dec'
  ).split(' '),
);

// A speakable piece shorter than this waits for the next one ("1." or "Ja.").
const MIN_CHARS = 12;
const MAX_CHARS = 280;

function isFenceLine(line: string): boolean {
  return /^\s{0,3}(```|~~~)/.test(line);
}

// Whether the dot, question or exclamation mark at `index` ends a sentence.
function endsSentence(text: string, index: number): boolean {
  const mark = text[index]!;
  if (mark !== '.') return true;
  // "…" written as three dots ends one; "3.5" or "helena.de" do not (no space follows anyway).
  const before = /([\p{L}\p{N}]+)$/u.exec(text.slice(Math.max(0, index - 20), index));
  if (!before) return true;
  const word = before[1]!.toLowerCase();
  // "3. Oktober", "z. B.", "Dr. Weber"
  if (/^\p{N}+$/u.test(word) || word.length === 1) return false;
  return !ABBREVIATION.has(word);
}

// The positions (exclusive ends) in text[from..] where a speakable piece ends. While the text is
// still growing, a piece ends only where what follows is already known: a sentence mark needs
// the space after it, a line its line break.
function boundaries(text: string, from: number, final: boolean): number[] {
  const found: number[] = [];
  let inFence = false;
  let lineStart = from;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const complete = newline !== -1;
    const lineEnd = complete ? newline : text.length;
    const line = text.slice(lineStart, lineEnd);
    if (isFenceLine(line)) {
      // A fence line is only known to be one once it is complete, or the answer ended.
      if (!complete && !final) break;
      inFence = !inFence;
      if (!inFence) found.push(complete ? newline + 1 : lineEnd);
    } else if (!inFence) {
      // A half-arrived line that may still become a fence ("`", "``") waits.
      if (!complete && !final && /^\s{0,3}[`~]{1,2}$/.test(line)) break;
      for (let index = lineStart; index < lineEnd; index += 1) {
        const char = text[index]!;
        if (char !== '.' && char !== '!' && char !== '?' && char !== '…') continue;
        // Runs of marks ("?!", "...") end together.
        let end = index + 1;
        while (end < lineEnd && /[.!?…"“”'’)»«\]]/.test(text[end]!)) end += 1;
        if (end < lineEnd ? /\s/.test(text[end]!) : complete || final) {
          if (endsSentence(text, index)) found.push(end);
        }
        index = end - 1;
      }
      if (complete) found.push(newline + 1);
    }
    if (!complete) break;
    lineStart = newline + 1;
  }
  if (final && !inFence && (found.length === 0 || found.at(-1)! < text.length)) {
    found.push(text.length);
  }
  return [...new Set(found)].filter((position) => position > from).sort((a, b) => a - b);
}

// A piece longer than MAX_CHARS cut at the last comma, semicolon or dash before the limit, else
// at the last space.
function splitLong(piece: string): string[] {
  const parts: string[] = [];
  let rest = piece;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    let cut = Math.max(
      window.lastIndexOf(', '),
      window.lastIndexOf('; '),
      window.lastIndexOf(' – '),
      window.lastIndexOf(' - '),
    );
    if (cut < MAX_CHARS / 3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = MAX_CHARS - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Whether what is left after `offset` already ends like a finished sentence ("…hören." with
// nothing after it), outside a code block. While an answer streams, such a tail is only held
// back because nothing has followed it yet; the conversation reads it once the text has been
// quiet for a moment, instead of waiting for the answer to be closed. Agents write their
// answer in one piece and close it a second or two later (Hermes saves its session first), so
// a short answer — one sentence — used to wait all of that time.
export function settledTail(markdown: string, offset: number): boolean {
  const tail = markdown.slice(offset);
  if (!tail.trim()) return false;
  // An open fence: the code block is still coming.
  const fences = tail.split('\n').filter(isFenceLine).length;
  if (fences % 2 === 1) return false;
  const trimmed = tail.replace(/[\s"“”'’)»«\]]+$/u, '');
  const last = trimmed.length - 1;
  if (last < 0) return false;
  const mark = trimmed[last]!;
  if (mark !== '.' && mark !== '!' && mark !== '?' && mark !== '…') return false;
  // "z. B." or "3." at the very end is not the end of a sentence yet.
  return endsSentence(markdown, offset + last);
}

// The next pieces of `markdown` to read aloud from `offset`, and where reading stands after
// them. With `final` (the answer is complete) the rest goes too.
export function nextSpeechChunks(markdown: string, offset: number, final: boolean): SpeechChunks {
  const ends = boundaries(markdown, offset, final);
  const chunks: string[] = [];
  let start = offset;
  let consumed = offset;
  let pending = '';
  for (const end of ends) {
    const spoken = speechText(markdown.slice(start, end)).replace(/\s+/g, ' ').trim();
    start = end;
    // Pieces joined because each was short (a heading, list items) keep a pause between them.
    const joined = !pending
      ? spoken
      : !spoken
        ? pending
        : `${pending}${/[.!?:;,…]$/.test(pending) ? ' ' : ', '}${spoken}`;
    if (!joined) {
      consumed = end;
      continue;
    }
    const last = end === ends.at(-1);
    if (joined.length < MIN_CHARS && !(last && final)) {
      pending = joined;
      continue;
    }
    chunks.push(...splitLong(joined));
    pending = '';
    consumed = end;
  }
  if (pending && final) {
    chunks.push(pending);
    consumed = markdown.length;
  }
  return { chunks, offset: consumed };
}
