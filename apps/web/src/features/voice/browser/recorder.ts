import { WHISPER_RATE } from '../utils/wav';

// Dictation's recording for Helena's local transcription: the browser's MediaRecorder (Opus in
// WebM or Ogg, AAC in MP4 on Safari), decoded and resampled to 16 kHz mono when it stops. Only
// on a secure page: browsers lend the microphone nowhere else.

// The microphone as speech needs it: the browser's echo cancellation, noise suppression and
// level control on, one channel.
export const SPEECH_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface Recording {
  // Ends the recording and hands over its samples (16 kHz mono).
  stop(): Promise<Float32Array>;
  // Ends it and throws it away.
  cancel(): void;
}

export class MicrophoneError extends Error {
  constructor(readonly reason: 'blocked' | 'missing' | 'failed') {
    super(reason);
  }
}

export function microphoneError(error: unknown): MicrophoneError {
  if (error instanceof MicrophoneError) return error;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return new MicrophoneError('blocked');
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
      return new MicrophoneError('missing');
  }
  return new MicrophoneError('failed');
}

export async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: SPEECH_CONSTRAINTS });
  } catch (error) {
    throw microphoneError(error);
  }
}

function recorderType(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return types.find((type) => MediaRecorder.isTypeSupported?.(type));
}

// Any recording the browser can decode, as 16 kHz mono samples (the browser resamples, with
// its own filters, in an OfflineAudioContext).
export async function decodeTo16kMono(audio: Blob): Promise<Float32Array> {
  const data = await audio.arrayBuffer();
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(data);
  } finally {
    void context.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_RATE));
  const offline = new OfflineAudioContext(1, frames, WHISPER_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Starts recording. `onLevel` gets the input level (0…1) a few times a second for the button's
// meter; `onLimit` is called when `maxSeconds` is reached (the recording then stops itself and
// `stop()` hands it over).
export async function startRecording(options: {
  maxSeconds: number;
  onLevel?: (level: number) => void;
  onLimit?: () => void;
}): Promise<Recording> {
  const stream = await openMicrophone();
  const type = recorderType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw microphoneError(error);
  }
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve) =>
    recorder.addEventListener('stop', () => resolve(), { once: true }),
  );

  // The level meter: an analyser on the same stream, read on animation frames.
  let meter: AudioContext | null = null;
  let frame = 0;
  if (options.onLevel) {
    meter = new AudioContext();
    const analyser = meter.createAnalyser();
    analyser.fftSize = 512;
    meter.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      options.onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const release = () => {
    cancelAnimationFrame(frame);
    void meter?.close();
    meter = null;
    for (const track of stream.getTracks()) track.stop();
  };
  const limit = window.setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
    options.onLimit?.();
  }, options.maxSeconds * 1000);

  recorder.start(250);
  return {
    async stop() {
      window.clearTimeout(limit);
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      release();
      const audio = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (audio.size === 0) return new Float32Array(0);
      return decodeTo16kMono(audio);
    },
    cancel() {
      window.clearTimeout(limit);
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}
