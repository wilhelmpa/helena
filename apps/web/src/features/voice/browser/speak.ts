import { nextSpeechChunks } from '../utils/speechChunks';
import type { Speaker } from '../utils/voiceEngine';
import { canSpeak, createResilientSpeaker, type VoiceSpeaker } from './speakers';

// Reading one answer aloud, shared by the per-message button, the composer's "read everything"
// mode, the answers to spoken questions and the preview in the voice settings: with the voice the
// conversation mode uses — Helena's local voice where it runs (kept through a failed piece, and
// the browser's only where it stays unreachable, said in the composer; see createResilientSpeaker),
// otherwise the browser's. One answer at a time (a new one replaces it), in the page's language,
// sentence by sentence.

export { canSpeak };

let active: { speaker: VoiceSpeaker; onEnd?: () => void } | null = null;

export interface SpeakOptions {
  // Who reads (useVoice().speaker).
  speaker: Speaker;
  // How fast (the Sprache setting).
  speed?: number;
  // Called when it finished, failed or was replaced by another.
  onEnd?: () => void;
  // Called when the voice gave up (Helena's voice, without a browser fallback).
  onError?: () => void;
}

// Speaks `markdown` (without its Markdown). Returns false when there is nothing to say or no
// voice to say it with.
export function speak(markdown: string, options: SpeakOptions): boolean {
  if (options.speaker.engine === 'none') return false;
  const lang = (document.documentElement.lang || 'de').slice(0, 2).toLowerCase();
  const { chunks } = nextSpeechChunks(markdown, 0, true, lang);
  if (chunks.length === 0) return false;
  stopSpeaking();
  const mine: { speaker: VoiceSpeaker; onEnd?: () => void } = {
    speaker: createResilientSpeaker(
      {
        onStart: () => {},
        onIdle: () => {
          if (active !== mine) return;
          active = null;
          mine.speaker.destroy();
          mine.onEnd?.();
        },
        onError: () => options.onError?.(),
      },
      { speaker: options.speaker, rate: options.speed },
    ),
    onEnd: options.onEnd,
  };
  active = mine;
  // From a click (the read button) or after the member's own typing: audio may play.
  mine.speaker.unlock();
  for (const chunk of chunks) mine.speaker.enqueue(chunk);
  return true;
}

export function stopSpeaking() {
  const current = active;
  active = null;
  if (current) {
    current.speaker.clear();
    current.speaker.destroy();
    current.onEnd?.();
  } else if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
}
