import { speakText } from '@/lib/api/endpoints/voice';

// The conversation mode's voice: pieces of an answer (whole sentences, see speechChunks) are
// queued as they arrive and read one after the other. Two engines behind one interface:
//
// - the browser's speechSynthesis (works on plain http; the device's own voices, local ones
//   preferred, since Chrome's "Google" voices send the text to Google);
// - Helena's local voice (Lokale KI → Vorlesen): each piece is fetched as audio from the API
//   while the one before plays, and played through Web Audio in the page — which the browser's
//   echo cancellation knows about, so the owner can interrupt it by speaking even on
//   loudspeakers.
//
// Pausing keeps the piece being read and the ones queued; resuming reads that piece again from
// its start.

export interface VoiceSpeaker {
  readonly engine: 'browser' | 'local';
  enqueue(text: string): void;
  pause(): void;
  resume(): void;
  // Stops and forgets everything queued.
  clear(): void;
  // Stops and hands back what was not read yet (the current piece first).
  drain(): string[];
  // What is being read now and next: what an echo would repeat.
  reading(): string;
  busy(): boolean;
  // Called from a click (the conversation's start): lets audio play without another gesture.
  unlock(): void;
  destroy(): void;
}

export interface SpeakerEvents {
  onStart(): void;
  onIdle(): void;
  onError?(text: string, error: unknown): void;
}

// ── The browser's voices ─────────────────────────────────────────────────────────────────

export const canSpeak = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

// The best voice of the device for a language: exact locale before language, local before
// online (Chrome's "Google Deutsch" reads the text out on Google's servers).
export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const short = lang.slice(0, 2).toLowerCase();
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === lang.toLowerCase());
  const same = voices.filter((voice) => voice.lang.toLowerCase().startsWith(short));
  return (
    exact.find((voice) => voice.localService) ??
    same.find((voice) => voice.localService) ??
    exact[0] ??
    same[0]
  );
}

export function speechLanguage(): string {
  return document.documentElement.lang || navigator.language || 'de-DE';
}

export function createBrowserSpeaker(events: SpeakerEvents): VoiceSpeaker {
  const queue: string[] = [];
  let paused = false;
  let current: SpeechSynthesisUtterance | null = null;
  // Each utterance's end belongs to its own turn; a cancel must not start the next one.
  let turn = 0;
  let wasBusy = false;

  const setBusy = (busy: boolean) => {
    if (busy === wasBusy) return;
    wasBusy = busy;
    if (busy) events.onStart();
    else events.onIdle();
  };

  const next = () => {
    if (paused || current) return;
    const text = queue[0];
    if (text === undefined) {
      setBusy(false);
      return;
    }
    const mine = ++turn;
    const lang = speechLanguage();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    const done = () => {
      if (mine !== turn) return;
      current = null;
      queue.shift();
      next();
    };
    utterance.onend = done;
    utterance.onerror = (event) => {
      if (mine !== turn) return;
      if (event.error !== 'interrupted' && event.error !== 'canceled')
        events.onError?.(text, event);
      done();
    };
    // Kept referenced: Chrome drops the end event of an utterance nothing holds on to.
    current = utterance;
    setBusy(true);
    window.speechSynthesis.speak(utterance);
  };

  const halt = () => {
    turn += 1;
    current = null;
    window.speechSynthesis.cancel();
  };

  return {
    engine: 'browser',
    enqueue(text) {
      if (!text.trim()) return;
      queue.push(text);
      next();
    },
    pause() {
      paused = true;
      halt();
    },
    resume() {
      if (!paused) return;
      paused = false;
      // Chrome drops a speak() that follows a cancel() too closely.
      window.setTimeout(next, 60);
    },
    clear() {
      paused = false;
      queue.length = 0;
      halt();
      setBusy(false);
    },
    drain() {
      const rest = [...queue];
      queue.length = 0;
      paused = false;
      halt();
      setBusy(false);
      return rest;
    },
    reading: () => queue.slice(0, 2).join(' '),
    busy: () => queue.length > 0,
    unlock() {
      // speechSynthesis needs no unlocking.
    },
    destroy() {
      queue.length = 0;
      halt();
    },
  };
}

// ── Helena's local voice ─────────────────────────────────────────────────────────────────

// How many pieces are fetched ahead of the one playing.
const PREFETCH = 2;

interface Piece {
  text: string;
  audio: Promise<AudioBuffer> | null;
  abort: AbortController;
}

export function createLocalSpeaker(
  events: SpeakerEvents,
  fetchAudio: (text: string, signal: AbortSignal) => Promise<Blob> = speakText,
): VoiceSpeaker {
  const queue: Piece[] = [];
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let paused = false;
  let playing = false;
  let turn = 0;
  let wasBusy = false;

  const audioContext = () => (context ??= new AudioContext());

  const setBusy = (busy: boolean) => {
    if (busy === wasBusy) return;
    wasBusy = busy;
    if (busy) events.onStart();
    else events.onIdle();
  };

  const load = (piece: Piece) => {
    piece.audio ??= fetchAudio(piece.text, piece.abort.signal)
      .then((blob) => blob.arrayBuffer())
      .then((data) => audioContext().decodeAudioData(data));
    // A failure is handled when the piece's turn comes.
    piece.audio.catch(() => {});
  };

  const prefetch = () => {
    for (const piece of queue.slice(0, PREFETCH + 1)) load(piece);
  };

  const stopSource = () => {
    turn += 1;
    playing = false;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source = null;
    }
  };

  const next = () => {
    if (paused || playing) return;
    const piece = queue[0];
    if (!piece) {
      setBusy(false);
      return;
    }
    playing = true;
    setBusy(true);
    prefetch();
    const mine = ++turn;
    piece
      .audio!.then((buffer) => {
        if (mine !== turn) return;
        const node = audioContext().createBufferSource();
        node.buffer = buffer;
        node.connect(audioContext().destination);
        node.onended = () => {
          if (mine !== turn) return;
          source = null;
          playing = false;
          queue.shift();
          next();
        };
        source = node;
        node.start();
      })
      .catch((error: unknown) => {
        if (mine !== turn) return;
        playing = false;
        queue.shift();
        events.onError?.(piece.text, error);
        next();
      });
  };

  const forget = (pieces: Piece[]) => {
    for (const piece of pieces) piece.abort.abort();
  };

  return {
    engine: 'local',
    enqueue(text) {
      if (!text.trim()) return;
      queue.push({ text, audio: null, abort: new AbortController() });
      prefetch();
      next();
    },
    pause() {
      paused = true;
      stopSource();
    },
    resume() {
      if (!paused) return;
      paused = false;
      next();
    },
    clear() {
      paused = false;
      stopSource();
      forget(queue.splice(0));
      setBusy(false);
    },
    drain() {
      paused = false;
      stopSource();
      const rest = queue.splice(0);
      forget(rest);
      setBusy(false);
      return rest.map((piece) => piece.text);
    },
    reading: () =>
      queue
        .slice(0, 2)
        .map((piece) => piece.text)
        .join(' '),
    busy: () => queue.length > 0,
    unlock() {
      void audioContext().resume();
    },
    destroy() {
      stopSource();
      forget(queue.splice(0));
      void context?.close();
      context = null;
    },
  };
}
