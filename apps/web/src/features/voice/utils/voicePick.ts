// Which of the browser's own voices reads Helena's answers when no local voice runs
// (docs/helena-decisions/voice-2.md §3). The device's voices only (Chrome's "Google" voices send
// the text to Google), in the page's language, and among those the most natural one: Apple's
// "Premium"/"Enhanced" and Siri voices, Microsoft's "Natural" ones — never the novelty voices
// macOS ships (Eddy, Flo, Grandma, …, Eloquence: robotic by design) or eSpeak, unless nothing
// else speaks the language.

export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

const NATURAL = /premium|enhanced|natural|neural|siri|verbessert|erweitert|online \(natural\)/i;
const ROBOTIC =
  /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|espeak|albert|bad news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;

export function voiceScore(voice: VoiceInfo, lang: string): number {
  const wanted = lang.toLowerCase();
  const short = wanted.slice(0, 2);
  const have = voice.lang.toLowerCase().replace('_', '-');
  if (!have.startsWith(short)) return -Infinity;
  let score = 0;
  if (have === wanted) score += 4;
  if (voice.localService) score += 8;
  if (NATURAL.test(voice.name)) score += 6;
  if (ROBOTIC.test(voice.name)) score -= 12;
  if (voice.default) score += 1;
  return score;
}

export function bestVoice<T extends VoiceInfo>(voices: readonly T[], lang: string): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = voiceScore(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
