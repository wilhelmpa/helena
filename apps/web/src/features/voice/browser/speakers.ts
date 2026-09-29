import { speakText } from '@/lib/api/endpoints/voice';
import { Pcm16Decoder, SampleBatcher } from '../utils/pcm';
import { bestVoice } from '../utils/voicePick';
import { markVoiceOutput } from './voiceOutput';

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
  // A piece is audible now (its sound started), not only queued or on its way.
  onAudible?(): void;
  onAnalyser?(analyser: AnalyserNode | null): void;
  onError?(text: string, error: unknown): void;
}

// ── The browser's voices ─────────────────────────────────────────────────────────────────

export const canSpeak = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

// The best voice of the device for a language (utils/voicePick.ts): local before online, the
// natural ones before the robotic ones.
export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  return bestVoice(window.speechSynthesis.getVoices(), lang);
}

export function speechLanguage(): string {
  return document.documentElement.lang || navigator.language || 'de-DE';
}

export function createBrowserSpeaker(
  events: SpeakerEvents,
  options: { rate?: number } = {},
): VoiceSpeaker {
  const queue: string[] = [];
  let paused = false;
  let current: SpeechSynthesisUtterance | null = null;
  // Each utterance's end belongs to its own turn; a cancel must not start the next one.
  let turn = 0;
  let wasBusy = false;
  const outputId = Symbol('browser-voice');

  const setBusy = (busy: boolean) => {
    if (busy === wasBusy) return;
    wasBusy = busy;
    markVoiceOutput(outputId, busy);
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
    if (options.rate) utterance.rate = options.rate;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    const done = () => {
      if (mine !== turn) return;
      current = null;
      queue.shift();
      next();
    };
    utterance.onstart = () => {
      if (mine === turn) events.onAudible?.();
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
      setBusy(false);
    },
  };
}

// ── Helena's local voice ─────────────────────────────────────────────────────────────────

// How many pieces are fetched ahead of the one playing.
const PREFETCH = 2;
// A streamed piece starts playing once this much sound has arrived, and goes on in larger
// batches (fewer nodes, same timeline).
const FIRST_BATCH_S = 0.08;
const LATER_BATCH_S = 0.25;
// Sound is scheduled this far ahead of the audio clock, so the first batch starts cleanly.
const LEAD_S = 0.04;

interface Piece {
  text: string;
  abort: AbortController;
  // The sound as it arrives, in order; `done` once all of it is here (or it failed).
  buffers: AudioBuffer[];
  done: boolean;
  failed: unknown;
  loading: boolean;
  // Wakes the player waiting for more of this piece.
  changed: (() => void) | null;
}

interface Playing {
  piece: Piece;
  turn: number;
  // The next buffer to schedule, and when on the audio clock it starts.
  index: number;
  at: number;
  sources: Set<AudioBufferSourceNode>;
  audible: boolean;
}

// The piece's audio, read as it comes: a WAV (any server) is decoded whole; raw PCM
// (`audio/pcm`, a server that generates as it goes) is turned into buffers batch by batch, so
// the first words play while the rest of the sentence is still being made.
async function readPiece(
  response: Response,
  context: AudioContext,
  push: (buffer: AudioBuffer) => void,
): Promise<void> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('audio/pcm') || !response.body) {
    push(await context.decodeAudioData(await response.arrayBuffer()));
    return;
  }
  const rate = Number(response.headers.get('x-helena-sample-rate')) || 24_000;
  const decoder = new Pcm16Decoder();
  const batcher = new SampleBatcher(Math.round(rate * FIRST_BATCH_S));
  const toBuffer = (samples: Float32Array) => {
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return buffer;
  };
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const batch = batcher.add(decoder.push(value));
    if (batch) {
      push(toBuffer(batch));
      batcher.min = Math.round(rate * LATER_BATCH_S);
    }
  }
  const rest = batcher.flush();
  if (rest) push(toBuffer(rest));
}

export function createLocalSpeaker(
  events: SpeakerEvents,
  fetchAudio: (text: string, signal: AbortSignal) => Promise<Response> = (text, signal) =>
    speakText(text, speechLanguage().slice(0, 2).toLowerCase(), signal),
): VoiceSpeaker {
  const queue: Piece[] = [];
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let playing: Playing | null = null;
  let paused = false;
  let turn = 0;
  let wasBusy = false;
  const outputId = Symbol('local-voice');

  const audioContext = () => {
    if (!context) {
      context = new AudioContext();
      if (events.onAnalyser) {
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.connect(context.destination);
        events.onAnalyser(analyser);
      }
    }
    return context;
  };

  const setBusy = (busy: boolean) => {
    if (busy === wasBusy) return;
    wasBusy = busy;
    markVoiceOutput(outputId, busy);
    if (busy) events.onStart();
    else events.onIdle();
  };

  const wake = (piece: Piece) => {
    const changed = piece.changed;
    piece.changed = null;
    changed?.();
  };

  const load = (piece: Piece) => {
    if (piece.loading) return;
    piece.loading = true;
    void fetchAudio(piece.text, piece.abort.signal)
      .then((response) =>
        readPiece(response, audioContext(), (buffer) => {
          piece.buffers.push(buffer);
          wake(piece);
        }),
      )
      .catch((error: unknown) => {
        piece.failed = error ?? new Error('failed');
      })
      .finally(() => {
        piece.done = true;
        wake(piece);
      });
  };

  const prefetch = () => {
    for (const piece of queue.slice(0, PREFETCH + 1)) load(piece);
  };

  const stopSources = () => {
    turn += 1;
    const current = playing;
    playing = null;
    if (!current) return;
    current.piece.changed = null;
    for (const node of current.sources) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    current.sources.clear();
  };

  // Schedules what has arrived of the playing piece, back to back on the audio clock, and moves
  // on once all of it has been heard.
  const pump = () => {
    const current = playing;
    if (!current || current.turn !== turn) return;
    const { piece } = current;
    const ctx = audioContext();
    while (current.index < piece.buffers.length) {
      const buffer = piece.buffers[current.index]!;
      current.index += 1;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(analyser ?? ctx.destination);
      const at = Math.max(current.at, ctx.currentTime + LEAD_S);
      node.start(at);
      current.at = at + buffer.duration;
      current.sources.add(node);
      node.onended = () => {
        current.sources.delete(node);
        if (current.turn === turn) pump();
      };
      if (!current.audible) {
        current.audible = true;
        window.setTimeout(
          () => {
            if (current.turn === turn) events.onAudible?.();
          },
          Math.max(0, (at - ctx.currentTime) * 1000),
        );
      }
    }
    if (!piece.done || current.sources.size > 0) {
      if (!piece.done) piece.changed = pump;
      return;
    }
    // All of it heard (or it failed): the next piece.
    playing = null;
    queue.shift();
    if (piece.failed) events.onError?.(piece.text, piece.failed);
    next();
  };

  const next = () => {
    if (paused || playing) return;
    const piece = queue[0];
    if (!piece) {
      setBusy(false);
      return;
    }
    setBusy(true);
    prefetch();
    playing = { piece, turn: ++turn, index: 0, at: 0, sources: new Set(), audible: false };
    pump();
  };

  const forget = (pieces: Piece[]) => {
    for (const piece of pieces) piece.abort.abort();
  };

  return {
    engine: 'local',
    enqueue(text) {
      if (!text.trim()) return;
      queue.push({
        text,
        abort: new AbortController(),
        buffers: [],
        done: false,
        failed: null,
        loading: false,
        changed: null,
      });
      prefetch();
      next();
    },
    pause() {
      paused = true;
      stopSources();
    },
    resume() {
      if (!paused) return;
      paused = false;
      next();
    },
    clear() {
      paused = false;
      stopSources();
      forget(queue.splice(0));
      setBusy(false);
    },
    drain() {
      paused = false;
      stopSources();
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
      stopSources();
      forget(queue.splice(0));
      setBusy(false);
      events.onAnalyser?.(null);
      analyser?.disconnect();
      analyser = null;
      void context?.close();
      context = null;
    },
  };
}
