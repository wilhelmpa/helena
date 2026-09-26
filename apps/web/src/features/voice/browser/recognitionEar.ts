import {
  recognitionConstructor,
  recognitionLanguage,
  type BrowserRecognition,
} from '@/utils/speechRecognition';
import type { ConversationEar, EarEvents } from './vadListener';

// The conversation mode's ear while Lokale KI → Transkription is off (or, in "prefer", down):
// the browser's own continuous speech recognition (Chrome, Edge, Safari; they send the audio to
// their vendor). It finds the words itself; a turn ends when nothing new was recognized for a
// moment after a final result.

// How long after the last final result the turn ends.
const TURN_END_MS = 900;

export function startRecognitionEar(events: EarEvents): ConversationEar {
  const Recognition = recognitionConstructor();
  if (!Recognition) throw new Error('No speech recognition');
  let active = true;
  let heard = '';
  let speaking = false;
  let timer = 0;
  let recognition: BrowserRecognition | null = null;

  const endTurn = () => {
    window.clearTimeout(timer);
    const text = heard.trim();
    heard = '';
    if (!speaking && !text) return;
    speaking = false;
    if (text) events.onUtterance(null, text);
    else events.onMisfire();
  };

  const begin = () => {
    if (!active) return;
    const next = new Recognition();
    next.continuous = true;
    next.interimResults = true;
    next.lang = recognitionLanguage();
    next.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        if (result.isFinal) heard += ` ${result[0].transcript}`;
        else interim += result[0].transcript;
      }
      if (!speaking && (interim.trim() || heard.trim())) {
        speaking = true;
        events.onSpeechStart();
      }
      window.clearTimeout(timer);
      // A turn ends a moment after the last final words, unless more words are still coming.
      if (!interim.trim() && heard.trim()) timer = window.setTimeout(endTurn, TURN_END_MS);
    };
    next.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        active = false;
        events.onError?.('blocked');
      } else if (event.error === 'audio-capture') {
        active = false;
        events.onError?.('missing');
      } else if (event.error === 'network') {
        active = false;
        events.onError?.('network');
      }
    };
    // Recognition ends on its own after a silence or a minute; while the conversation runs it
    // starts again.
    next.onend = () => {
      if (heard.trim() || speaking) endTurn();
      if (active) window.setTimeout(begin, 150);
    };
    recognition = next;
    try {
      next.start();
    } catch {
      active = false;
      events.onError?.('failed');
    }
  };
  begin();

  return {
    pauseMs: TURN_END_MS,
    setGuarded() {
      // The browser decides what speech is; nothing to tune.
    },
    async destroy() {
      active = false;
      window.clearTimeout(timer);
      recognition?.abort();
      recognition = null;
    },
  };
}
