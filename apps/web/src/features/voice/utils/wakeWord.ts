const WAKE_WORD = /^(?:ava|eywa|ewa|aiwa)(?=$|[\s,.:;!?])/iu;

export function wakeWordRemainder(transcript: string): string | null {
  const match = WAKE_WORD.exec(transcript.trimStart());
  if (!match) return null;
  return transcript
    .trimStart()
    .slice(match[0].length)
    .replace(/^[\s,.:;!?]+/u, '')
    .trim();
}
