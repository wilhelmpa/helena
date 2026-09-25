import type { VoiceStatus } from '@/lib/api/endpoints/voice';

// Which engine listens and which one speaks, from what the browser can do and what Lokale KI
// allows (docs/helena-decisions/voice.md):
//
// - Listening needs the microphone, which browsers lend only to a secure page (HTTPS, localhost,
//   or an origin the owner marked as secure in Chrome). On plain http nothing listens, whatever
//   the engine.
// - "Transkription" local (prefer or only, and the model server takes it now): Helena records
//   and Whisper on this machine writes it down.
// - "Transkription" off, or prefer while local is down: the browser's own recognition (Chrome
//   and Safari send the audio to their vendor; Firefox has none).
// - "Transkription" only while local is down: nothing — the voice must not leave the machine.
// - Speaking: "Vorlesen" local → Helena's voice; only while down → nothing is read; otherwise
//   the browser's voices (speechSynthesis works on plain http too).

export interface BrowserVoice {
  secure: boolean;
  recognition: boolean;
  recorder: boolean;
  synthesis: boolean;
}

export type ListenBlocker =
  // The page is not a secure context: no microphone.
  | 'insecure'
  // "Nur lokal" and the local model cannot take it now.
  | 'local-only-down'
  // Neither the local model nor the browser can listen (Firefox with Transkription off).
  | 'unsupported';

export type Listener = { engine: 'local' | 'browser' } | { engine: 'none'; blocker: ListenBlocker };

// `fallback`: the engine that takes over when Helena's voice fails in the middle of an answer
// (in "prefer"; "only" has none).
export type Speaker =
  { engine: 'local'; fallback: 'browser' | null } | { engine: 'browser' } | { engine: 'none' };

export function detectBrowserVoice(): BrowserVoice {
  if (typeof window === 'undefined')
    return { secure: false, recognition: false, recorder: false, synthesis: false };
  const speech = window as typeof window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return {
    secure: window.isSecureContext,
    recognition: Boolean(speech.SpeechRecognition ?? speech.webkitSpeechRecognition),
    recorder:
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      'MediaRecorder' in window &&
      'AudioContext' in window,
    synthesis: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  };
}

// Who writes down what the owner says. `status` is null while Helena's answer is not known
// (the API unreachable): then the browser's own engine, as before Lokale KI.
export function pickListener(status: VoiceStatus | null, browser: BrowserVoice): Listener {
  if (!browser.secure) return { engine: 'none', blocker: 'insecure' };
  const path = status?.transcription;
  if (path?.local && browser.recorder) return { engine: 'local' };
  if (path?.mode === 'only')
    return {
      engine: 'none',
      blocker: path.local ? 'unsupported' : 'local-only-down',
    };
  if (browser.recognition) return { engine: 'browser' };
  return { engine: 'none', blocker: 'unsupported' };
}

// Who reads the answers aloud.
export function pickSpeaker(status: VoiceStatus | null, browser: BrowserVoice): Speaker {
  const path = status?.speech;
  // Helena's voice plays through the page (Web Audio), which any browser can.
  if (path?.local)
    return {
      engine: 'local',
      fallback: path.mode !== 'only' && browser.synthesis ? 'browser' : null,
    };
  if (path?.mode === 'only') return { engine: 'none' };
  return browser.synthesis ? { engine: 'browser' } : { engine: 'none' };
}
