import { speakText } from '@/lib/api/endpoints/voice';
import { Pcm16Decoder, SampleBatcher } from '../utils/pcm';
import { bestVoice } from '../utils/voicePick';
import type { Speaker } from '../utils/voiceEngine';
import { markVoiceOutput } from './voiceOutput';
import { setVoiceFallback } from './voiceFallback';

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
  preload(texts: string[]): void;
  warm?(text: string): void;
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
  // A new answer starts: a voice that fell back to the browser's tries Helena's again.
  renew?(): void;
  destroy(): void;
}

export interface SpeakerEvents {
  onStart(): void;
  onIdle(): void;
  // A piece is audible now (its sound started), not only queued or on its way.
  onAudible?(text: string): void;
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
      if (mine === turn) events.onAudible?.(text);
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
    preload() {},
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
  const preloaded = new Map<string, Piece>();
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let playing: Playing | null = null;
  let paused = false;
  let turn = 0;
  let wasBusy = false;
  const outputId = Symbol('local-voice');
  let loading = 0;
  let destroyed = false;
  let nextWarm: string | null = null;

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
    if (piece.loading || piece.abort.signal.aborted) return;
    piece.loading = true;
    loading += 1;
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
        loading -= 1;
        wake(piece);
        prefetch();
      });
  };

  const prefetch = () => {
    if (destroyed) return;
    for (const piece of queue.slice(0, PREFETCH + 1)) {
      if (loading >= PREFETCH + 1) break;
      load(piece);
    }
    if (queue.length === 0 && loading === 0) {
      const piece = nextWarm ? preloaded.get(nextWarm) : preloaded.values().next().value;
      if (piece && !piece.loading) load(piece);
      nextWarm = null;
    }
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
        const samples = buffer.getChannelData(0);
        const onset = samples.findIndex((sample) => Math.abs(sample) > 0.003);
        if (onset < 0) continue;
        current.audible = true;
        window.setTimeout(
          () => {
            if (current.turn === turn) events.onAudible?.(piece.text);
          },
          Math.max(0, (at + onset / buffer.sampleRate - ctx.currentTime) * 1000),
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
      prefetch();
      return;
    }
    setBusy(true);
    prefetch();
    playing = { piece, turn: ++turn, index: 0, at: 0, sources: new Set(), audible: false };
    pump();
  };

  const forget = (pieces: Piece[]) => {
    for (const piece of pieces) if (preloaded.get(piece.text) !== piece) piece.abort.abort();
  };

  return {
    engine: 'local',
    enqueue(text) {
      if (!text.trim()) return;
      const cached = preloaded.get(text);
      const piece =
        cached && !cached.failed
          ? cached
          : {
              text,
              abort: new AbortController(),
              buffers: [],
              done: false,
              failed: null,
              loading: false,
              changed: null,
            };
      if (cached?.failed) preloaded.set(text, piece);
      queue.push(piece);
      prefetch();
      next();
    },
    preload(texts) {
      for (const text of texts) {
        if (preloaded.has(text)) continue;
        const piece: Piece = {
          text,
          abort: new AbortController(),
          buffers: [],
          done: false,
          failed: null,
          loading: false,
          changed: null,
        };
        preloaded.set(text, piece);
      }
      prefetch();
    },
    warm(text) {
      if (!preloaded.has(text) || destroyed) return;
      nextWarm = text;
      prefetch();
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
      destroyed = true;
      stopSources();
      forget(queue.splice(0));
      for (const piece of preloaded.values()) piece.abort.abort();
      preloaded.clear();
      setBusy(false);
      events.onAnalyser?.(null);
      analyser?.disconnect();
      analyser = null;
      void context?.close();
      context = null;
    },
  };
}

// ── One voice that keeps going ───────────────────────────────────────────────────────────

// How often, and after how long, a piece Helena's voice failed on is tried again before the
// browser's voice takes over.
const LOCAL_RETRY_DELAYS_MS = [250, 900];

export interface ResilientOptions {
  // Who reads (voiceEngine.pickSpeaker): Helena's voice with the browser's as its fallback, or
  // the browser's alone.
  speaker: Speaker;
  rate?: number;
  makeLocal?: (events: SpeakerEvents) => VoiceSpeaker;
  makeBrowser?: (events: SpeakerEvents, options: { rate?: number }) => VoiceSpeaker;
  retryDelaysMs?: number[];
  // The browser's voice reads because Helena's could not be reached (true), or Helena's voice is
  // back (false). Also published as voiceFallbackActive() for the composer's notice.
  onFallback?: (active: boolean) => void;
}

// The voice everything reads with (the conversation, the read-aloud button, "read everything").
// One failed piece is no reason to change voices: Helena's voice is asked for it again (twice,
// with a short wait: the model server is often only busy) and only when that fails as well is
// the browser's voice used — for what is still to read, said in the composer — and Helena's
// voice is tried again from the next answer (renew). Where the browser has no fallback ("only
// local") the failure is reported and the rest of that answer stays unread.
export function createResilientSpeaker(
  events: SpeakerEvents,
  options: ResilientOptions,
): VoiceSpeaker {
  const makeLocal = options.makeLocal ?? createLocalSpeaker;
  const makeBrowser = options.makeBrowser ?? createBrowserSpeaker;
  const delays = options.retryDelaysMs ?? LOCAL_RETRY_DELAYS_MS;
  const wantsLocal = options.speaker.engine === 'local';
  const canFallBack = options.speaker.engine === 'local' && options.speaker.fallback === 'browser';

  let local: VoiceSpeaker | null = null;
  let browser: VoiceSpeaker | null = null;
  let active: VoiceSpeaker | null = null;
  let fallback = false;
  let renewWhenIdle = false;
  let failures = 0;
  // Events of a voice that is being emptied to pass its pieces on are not the listener's.
  let swapping = false;
  let busy = false;
  // Pieces waiting for the retry of Helena's voice.
  let held: string[] | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let destroyed = false;

  const setBusy = (next: boolean) => {
    if (next === busy) return;
    busy = next;
    if (next) events.onStart();
    else events.onIdle();
  };
  const setFallback = (next: boolean) => {
    if (next === fallback) return;
    fallback = next;
    setVoiceFallback(next);
    options.onFallback?.(next);
  };

  const innerEvents = (engine: 'local' | 'browser'): SpeakerEvents => ({
    onStart: () => {
      if (!swapping) setBusy(true);
    },
    onIdle: () => {
      if (swapping || held) return;
      // A fallback that has read what it had hands back to Helena's voice.
      if (engine === 'browser' && renewWhenIdle) toLocal();
      setBusy(false);
    },
    onAudible: (text) => {
      if (engine === 'local') failures = 0;
      events.onAudible?.(text);
    },
    onAnalyser: (analyser) => events.onAnalyser?.(analyser),
    onError: (text, error) => {
      if (engine === 'local' && wantsLocal) localFailed(text, error);
      else events.onError?.(text, error);
    },
  });

  const localVoice = () => (local ??= makeLocal(innerEvents('local')));
  const browserVoice = () =>
    (browser ??= makeBrowser(innerEvents('browser'), { rate: options.rate }));

  const toLocal = () => {
    renewWhenIdle = false;
    failures = 0;
    active = localVoice();
    setFallback(false);
  };

  const flushHeld = () => {
    retryTimer = null;
    const pieces = held;
    held = null;
    if (!pieces || destroyed) return;
    for (const piece of pieces) active?.enqueue(piece);
    if (pieces.length === 0 || !active?.busy()) setBusy(false);
  };

  const localFailed = (text: string, error: unknown) => {
    const failed = local;
    if (!failed) return;
    swapping = true;
    const rest = [text, ...failed.drain(), ...(held ?? [])];
    swapping = false;
    held = null;
    failures += 1;
    if (failures <= delays.length) {
      held = rest;
      if (retryTimer) clearTimeout(retryTimer);
      if (!paused) retryTimer = setTimeout(flushHeld, delays[failures - 1]);
      return;
    }
    if (canFallBack) {
      renewWhenIdle = false;
      active = browserVoice();
      setFallback(true);
      for (const piece of rest) active.enqueue(piece);
      return;
    }
    // Nothing to fall back to: said once, this answer stays unread; the next tries again.
    failures = 0;
    setBusy(false);
    events.onError?.(text, error);
  };

  active = wantsLocal ? localVoice() : options.speaker.engine === 'browser' ? browserVoice() : null;

  const all = () => [local, browser].filter((voice): voice is VoiceSpeaker => voice != null);

  return {
    get engine() {
      return active?.engine ?? 'local';
    },
    enqueue(text) {
      if (destroyed || !text.trim() || !active) return;
      if (held) {
        held.push(text);
        return;
      }
      active.enqueue(text);
    },
    preload(texts) {
      if (wantsLocal) localVoice().preload(texts);
    },
    warm(text) {
      if (wantsLocal) localVoice().warm?.(text);
    },
    pause() {
      paused = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      for (const voice of all()) voice.pause();
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const voice of all()) voice.resume();
      if (held && !retryTimer) retryTimer = setTimeout(flushHeld, 0);
    },
    clear() {
      paused = false;
      held = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      swapping = true;
      for (const voice of all()) voice.clear();
      swapping = false;
      setBusy(false);
    },
    drain() {
      paused = false;
      const rest = held ?? [];
      held = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      swapping = true;
      const queued = active?.drain() ?? [];
      swapping = false;
      setBusy(false);
      return [...queued, ...rest];
    },
    renew() {
      if (!fallback) {
        failures = 0;
        return;
      }
      if (browser?.busy()) renewWhenIdle = true;
      else toLocal();
    },
    reading: () => (held ? held.slice(0, 2).join(' ') : (active?.reading() ?? '')),
    busy: () => held != null || (active?.busy() ?? false),
    unlock() {
      // Helena's voice plays through Web Audio, which needs the click that starts a reading.
      if (wantsLocal) localVoice().unlock();
    },
    destroy() {
      destroyed = true;
      held = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      swapping = true;
      for (const voice of all()) voice.destroy();
      swapping = false;
      setBusy(false);
      setFallback(false);
    },
  };
}
