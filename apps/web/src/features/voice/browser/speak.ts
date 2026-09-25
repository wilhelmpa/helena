import { nextSpeechChunks } from '../utils/speechChunks';
import { canSpeak, createBrowserSpeaker, type VoiceSpeaker } from './speakers';

// Reading one answer aloud with the browser's voices, shared by the per-message button and the
// composer's "read answers aloud" mode: one answer at a time (a new one replaces it), in the
// page's language, sentence by sentence (Chrome's voices stop by themselves in a long single
// utterance), with the device's own voice preferred.

export { canSpeak };

let active: { speaker: VoiceSpeaker; onEnd?: () => void } | null = null;

// Speaks `markdown` (without its Markdown) and calls `onEnd` when it finished, failed or was
// replaced by another. Returns false when there is nothing to say.
export function speak(markdown: string, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  const lang = (document.documentElement.lang || 'de').slice(0, 2).toLowerCase();
  const { chunks } = nextSpeechChunks(markdown, 0, true, lang);
  if (chunks.length === 0) return false;
  stopSpeaking();
  const mine: { speaker: VoiceSpeaker; onEnd?: () => void } = {
    speaker: createBrowserSpeaker({
      onStart: () => {},
      onIdle: () => {
        if (active !== mine) return;
        active = null;
        mine.onEnd?.();
      },
    }),
    onEnd,
  };
  active = mine;
  for (const chunk of chunks) mine.speaker.enqueue(chunk);
  return true;
}

export function stopSpeaking() {
  const current = active;
  active = null;
  if (current) {
    current.speaker.clear();
    current.onEnd?.();
  } else if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
}
