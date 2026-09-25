// What Whisper answered, as the chat takes it. Whisper was trained on subtitled video, so on
// silence, breathing or a door it sometimes "hears" the credits of a subtitle file ("Untertitel
// im Auftrag des ZDF für funk, 2017", "Thank you for watching") or a sound label ("[Musik]").
// In a conversation that would be sent as the owner's message. A transcript that is nothing but
// such a line is dropped; anything that also carries real words is kept as it is.

const WHOLE_LINE: RegExp[] = [
  // "Untertitel im Auftrag des ZDF, 2017", "Untertitelung des ZDF für funk 2017"
  /^untertitel(ung)?( im auftrag)? (des|der|von) (zdf|ard|wdr|swr|br|ndr|mdr|hr|rbb|sr|funk)\b/,
  /\bamara\.org[ -]?community\b/,
  /^(copyright|©) (zdf|ard|wdr|swr|br|ndr|mdr|hr|rbb) \d{4}$/,
  /^(vielen dank|danke) (fürs|für das) zu(schauen|sehen|hören)$/,
  /^(thanks|thank you)( so much)? for watching$/,
  /^(please )?(like and )?subscribe( to (my|the|our) channel)?$/,
  /^sous-titr(age|es) /,
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

// The transcript to insert or send, trimmed; '' when there was nothing but a hallucinated
// subtitle line, a sound label or silence.
export function cleanTranscript(raw: string, maxLength = 10_000): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || SOUND_LABEL.test(text)) return '';
  const plain = normalized(text);
  if (!plain || WHOLE_LINE.some((pattern) => pattern.test(plain))) return '';
  return text.slice(0, maxLength);
}
