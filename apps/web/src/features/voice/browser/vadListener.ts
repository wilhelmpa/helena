import { DEFAULT_PAUSE_MS } from '../utils/voiceSettings';
import { SPEECH_CONSTRAINTS, microphoneError } from './recorder';

// The conversation mode's ear for Helena's local transcription: Silero VAD v5 in the browser
// (@ricky0123/vad-web, ISC; ONNX Runtime Web, MIT; the model MIT) decides when the owner starts
// and stops speaking and hands over each utterance as 16 kHz samples, which go to Whisper on this
// machine. Loaded only when a conversation starts; its files (the model, the audio worklet, ONNX
// Runtime's WebAssembly) are served by Helena itself from /voice/ (apps/web/scripts/
// voice-assets.mjs copies them from node_modules at build time), nothing from a CDN.
// Decision: docs/helena-decisions/voice.md.

export const VOICE_ASSET_PATH = '/voice/';

export interface ConversationEar {
  // How long a pause ends a turn: the time between the owner stopping and the ear saying so.
  readonly pauseMs: number;
  // While reading an answer aloud: only clear, sustained speech counts (the echo of the reading
  // is quieter and less sure than the owner's own voice).
  setGuarded(guarded: boolean): void;
  destroy(): Promise<void>;
}

export interface EarEvents {
  onSpeechStart(): void;
  onMisfire(): void;
  onUtterance(samples: Float32Array | null, text: string | null): void;
  // The input level (0…1), a few dozen times a second, for the meter.
  onLevel?(level: number): void;
  // The VAD's own stream, also used by the voice orb; never acquired a second time.
  onStream?(stream: MediaStream | null): void;
  // `network`: the browser's recognition service (Google's for Chrome) did not answer.
  onError?(reason: 'blocked' | 'missing' | 'failed' | 'network'): void;
}

// How the detector decides (vad-web's FrameProcessor, frames of 32 ms). The pause that ends a
// turn is the owner's setting (Sprache → "Pause bis zur Antwort", default 0.6 s; it was a fixed
// 0.8 s): long enough for a breath inside a sentence, short enough to feel like a conversation.
// 400 ms are kept before the detector was sure (320 cut the first syllable of a quiet start).
const detector = (pauseMs: number) => ({
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: pauseMs,
  preSpeechPadMs: 400,
  minSpeechMs: 250,
});
const guarded = (pauseMs: number) => ({
  ...detector(pauseMs),
  positiveSpeechThreshold: 0.8,
  minSpeechMs: 500,
});

export async function startVadEar(
  events: EarEvents,
  pauseMs = DEFAULT_PAUSE_MS,
): Promise<ConversationEar> {
  const NORMAL = detector(pauseMs);
  const GUARDED = guarded(pauseMs);
  const [{ MicVAD }, { log }] = await Promise.all([
    import('@ricky0123/vad-web'),
    import('@ricky0123/vad-web/dist/logging'),
  ]);
  // vad-web writes every step to the console; its errors and warnings stay.
  log.debug = () => {};
  const options = (processorType: 'AudioWorklet' | 'ScriptProcessor') => ({
    model: 'v5' as const,
    baseAssetPath: VOICE_ASSET_PATH,
    onnxWASMBasePath: VOICE_ASSET_PATH,
    processorType,
    startOnLoad: true,
    ...NORMAL,
    getStream: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: SPEECH_CONSTRAINTS });
      events.onStream?.(stream);
      return stream;
    },
    resumeStream: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: SPEECH_CONSTRAINTS });
      events.onStream?.(stream);
      return stream;
    },
    ortConfig: (ort: { env: { logLevel?: string; wasm: { numThreads?: number } } }) => {
      ort.env.logLevel = 'error';
      // Threads need a cross-origin isolated page; one is plenty for a 2 MB model.
      ort.env.wasm.numThreads = 1;
    },
    onSpeechRealStart: () => events.onSpeechStart(),
    onVADMisfire: () => events.onMisfire(),
    onSpeechEnd: (audio: Float32Array) => events.onUtterance(audio, null),
    onFrameProcessed: (_: unknown, frame: Float32Array) => {
      if (!events.onLevel) return;
      let sum = 0;
      for (const sample of frame) sum += sample * sample;
      events.onLevel(Math.min(1, Math.sqrt(sum / frame.length) * 4));
    },
  });
  let vad: Awaited<ReturnType<typeof MicVAD.new>>;
  try {
    // The audio worklet keeps the detector off the main thread; where the page's content
    // security policy or the browser refuses worklets, the older script processor does.
    try {
      vad = await MicVAD.new(options('AudioWorklet'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error;
      vad = await MicVAD.new(options('ScriptProcessor'));
    }
  } catch (error) {
    const reason = microphoneError(error).reason;
    events.onError?.(reason);
    throw microphoneError(error);
  }
  return {
    pauseMs,
    setGuarded(on) {
      vad.setOptions(on ? GUARDED : NORMAL);
    },
    async destroy() {
      events.onStream?.(null);
      await vad.destroy().catch(() => {});
    },
  };
}
