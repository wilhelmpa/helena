import {
  readModelServerKey,
  resolveLocalRoute,
  type LocalRoute,
  type RouteRefusal,
} from '@repo/db';
import type { LocalAiMode } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { joinUrl } from '#modules/local-ai/eval-context';
import { serverContext, serverType, taskClass } from '#modules/local-ai/service';
import { isAgentUser } from '#modules/agents/core/service';
import {
  correctVocabulary,
  helenaWords,
  readVoiceSettings,
  suggestedAliases,
  vocabularyPrompt,
  type VocabularyAlias,
} from './settings';
import {
  confidentText,
  judgeTranscript,
  type DropReason,
  type TranscriptSegment,
} from './transcript';
import { withTranscriptionAdmission } from './maintenance';
import { readWav, whisperWav } from './wav';
import { ttsText } from './tts-text';

// Voice in the chat (docs/helena-decisions/voice.md): dictation and the conversation mode send
// their recordings here, and the conversation mode's reading aloud asks here for audio. Both go
// to Helena's local AI (Lokale KI → "Transkription" and "Vorlesen"), with the model server's
// key kept in the API: the browser never talks to the model server. What the browser does when
// a path is off (its own speech recognition and voices) follows the class's mode:
//
//   off     the browser's own engines, as before Lokale KI (no local call is made);
//   prefer  local first; while local is down the browser's own engines;
//   only    local or nothing: nothing of the owner's voice or of the answers leaves the machine.

export const TRANSCRIPTION_CLASS = 'transcription';
export const SPEECH_CLASS = 'speech';

export const VOICE_LIMITS = {
  // One dictation or one turn of a conversation.
  maxSeconds: 120,
  minMs: 300,
  // 120 s of 16 kHz mono 16-bit PCM is 3.84 MB; a browser that could not resample sends 48 kHz.
  maxBytes: 12 * 1024 * 1024,
  // One sentence or a few: the conversation mode reads an answer sentence by sentence.
  maxSpeechChars: 1_000,
};

// The largest audio a speech model may answer with (a few sentences of 24 kHz WAV are ~1 MB).
const MAX_SPEECH_BYTES = 16 * 1024 * 1024;
// Whisper on the NPU needs a few seconds for two minutes of audio; loading the model first
// takes longer.
const TRANSCRIBE_TIMEOUT_MS = 90_000;
const SPEECH_TIMEOUT_MS = 60_000;

// Only people talk to Helena by voice; an agent's key gets a 403 here.
export async function requireHuman(userId: string): Promise<void> {
  if (await isAgentUser(userId)) throw new HttpError(403, 'Voice is for people, not agents');
}

// ── Where each path runs now ─────────────────────────────────────────────────────────────

export interface VoicePath {
  // The class's mode; `off` also while the master switch is off.
  mode: LocalAiMode;
  // Whether Helena sends this work to a local model right now.
  local: boolean;
  // Why not, when it does not.
  reason: RouteRefusal | 'not-registered' | null;
  // The local model (`helena-<slug>/<id>`) while local.
  model: string | null;
}

type Routed = { route: LocalRoute } | { path: VoicePath };

async function routeOf(classId: string): Promise<Routed> {
  const entry = taskClass(classId);
  if (!entry) return { path: { mode: 'off', local: false, reason: 'not-registered', model: null } };
  const result = await resolveLocalRoute({
    classId,
    unit: entry.unit,
    capability: entry.capability,
  });
  if ('route' in result) return { route: result.route };
  const mode = result.refusal === 'master-off' ? 'off' : result.mode;
  return { path: { mode, local: false, reason: result.refusal, model: null } };
}

function pathOf(routed: Routed): VoicePath {
  if ('path' in routed) return routed.path;
  return { mode: routed.route.mode, local: true, reason: null, model: routed.route.modelId };
}

export async function voiceStatus() {
  const [transcription, speech, settings] = await Promise.all([
    routeOf(TRANSCRIPTION_CLASS),
    routeOf(SPEECH_CLASS),
    readVoiceSettings(),
  ]);
  return {
    transcription: pathOf(transcription),
    speech: pathOf(speech),
    // What the browser applies itself.
    settings: { pauseMs: settings.pauseMs, speed: settings.speed },
    limits: {
      maxSeconds: VOICE_LIMITS.maxSeconds,
      maxBytes: VOICE_LIMITS.maxBytes,
      maxSpeechChars: VOICE_LIMITS.maxSpeechChars,
    },
  };
}

// The route a request goes to, or the refusal the browser acts on: `voice-local-off` (the class
// or local AI is off: use the browser's engine), `voice-local-unavailable` (local is on but
// cannot take it now: in `prefer` the browser's engine, in `only` nothing).
async function requireRoute(classId: string): Promise<LocalRoute> {
  const routed = await routeOf(classId);
  if ('route' in routed) return routed.route;
  const { mode, reason } = routed.path;
  if (mode === 'off' || reason === 'class-off' || reason === 'master-off')
    throw new HttpError(409, `Local AI does not take this (${reason})`, 'voice-local-off');
  throw new HttpError(
    503,
    `Local AI cannot take this now (${reason})${mode === 'only' ? '; it stays on this machine' : ''}`,
    'voice-local-unavailable',
  );
}

function authorization(key: string | null): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {};
}

// ── Speech to text ───────────────────────────────────────────────────────────────────────

export interface Transcription {
  text: string;
  // Why the text is empty although something was heard: nothing but noise, a line Whisper
  // invents on silence, or another language than the one asked for (transcript.ts).
  dropped: DropReason | null;
  model: string;
  durationMs: number;
  latencyMs: number;
}

// The words of one transcription's context: the owner's own and Helena's names, read once a
// minute (a new agent or project is known a minute later).
let vocabularyCache: { at: number; prompt: string | null; aliases: VocabularyAlias[] } | null =
  null;
const VOCABULARY_TTL_MS = 60_000;

async function transcriptionContext(): Promise<{
  prompt: string | null;
  aliases: VocabularyAlias[];
}> {
  const now = Date.now();
  if (!vocabularyCache || now - vocabularyCache.at > VOCABULARY_TTL_MS) {
    const [settings, words] = await Promise.all([
      readVoiceSettings(),
      helenaWords().catch(() => ['Helena']),
    ]);
    vocabularyCache = {
      at: now,
      prompt: vocabularyPrompt(settings.vocabulary, words),
      aliases: settings.vocabularyAliases ?? suggestedAliases(words),
    };
  }
  return { prompt: vocabularyCache.prompt, aliases: vocabularyCache.aliases };
}

export function forgetVoiceVocabulary(): void {
  vocabularyCache = null;
}

// The answer of `/audio/transcriptions`: `{ text }`, and with verbose_json (whisper.cpp) the
// segments with Whisper's own confidence.
function transcriptOf(body: unknown): { text: string; segments: TranscriptSegment[] } | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as { text?: unknown; segments?: unknown };
  if (typeof value.text !== 'string') return null;
  const segments = Array.isArray(value.segments)
    ? value.segments.flatMap((segment): TranscriptSegment[] => {
        if (!segment || typeof segment !== 'object') return [];
        const entry = segment as Record<string, unknown>;
        if (typeof entry.text !== 'string') return [];
        const number = (field: unknown) =>
          typeof field === 'number' && Number.isFinite(field) ? field : null;
        return [
          {
            text: entry.text,
            noSpeechProb: number(entry.no_speech_prob),
            avgLogprob: number(entry.avg_logprob),
          },
        ];
      })
    : [];
  return { text: value.text, segments };
}

export async function transcribe(input: {
  audio: Uint8Array;
  language: string | null;
}): Promise<Transcription> {
  if (input.audio.byteLength > VOICE_LIMITS.maxBytes)
    throw new HttpError(413, 'The recording is too large', 'voice-too-long');
  const info = readWav(input.audio);
  if (!info)
    throw new HttpError(400, 'The recording is not an uncompressed WAV file', 'voice-bad-audio');
  if (info.durationMs < VOICE_LIMITS.minMs)
    throw new HttpError(400, 'The recording is too short', 'voice-too-short');
  if (info.durationMs > VOICE_LIMITS.maxSeconds * 1000)
    throw new HttpError(
      413,
      `The recording is longer than ${VOICE_LIMITS.maxSeconds} seconds`,
      'voice-too-long',
    );
  const route = await requireRoute(TRANSCRIPTION_CLASS);
  const [key, context] = await Promise.all([
    readModelServerKey(route.server),
    transcriptionContext(),
  ]);
  const form = new FormData();
  form.append(
    'file',
    new Blob([whisperWav(input.audio, info)], { type: 'audio/wav' }),
    'recording.wav',
  );
  form.append('model', route.model);
  // A server that takes the whole OpenAI shape (whisper.cpp) gets the vocabulary as the
  // recording's context (Whisper's `prompt`), greedy decoding at temperature 0 (the steadiest
  // text, and the fastest) and verbose_json with each segment's own confidence. Lemonade
  // documents none of that; it gets what it did before.
  const full = serverType(route.server.kind)?.audio?.transcriptionContext ?? true;
  if (full) {
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (context.prompt) form.append('prompt', context.prompt);
  } else {
    form.append('response_format', 'json');
  }
  if (input.language) form.append('language', input.language);
  return withTranscriptionAdmission(async () => {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(joinUrl(route.server.baseUrl, '/audio/transcriptions'), {
        method: 'POST',
        headers: { accept: 'application/json', ...authorization(key) },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, 'The local transcription did not answer', 'voice-local-failed');
    }
    if (!response.ok) {
      throw new HttpError(
        502,
        `The local transcription failed (HTTP ${response.status})`,
        'voice-local-failed',
      );
    }
    const transcript = transcriptOf(await response.json().catch(() => null));
    if (!transcript)
      throw new HttpError(502, 'The local transcription answered no text', 'voice-local-failed');
    const heard = transcript.segments.length ? confidentText(transcript.segments) : transcript.text;
    const judged = judgeTranscript(heard, { language: input.language });
    return {
      text: judged.dropped ? judged.text : correctVocabulary(judged.text, context.aliases),
      dropped: judged.dropped,
      model: route.modelId,
      durationMs: info.durationMs,
      latencyMs: Date.now() - started,
    };
  });
}

// ── Text to speech ───────────────────────────────────────────────────────────────────────

export interface SpeechAudio {
  // A whole file, or raw 16-bit mono PCM streamed as the server generates it.
  audio: ArrayBuffer | ReadableStream<Uint8Array>;
  contentType: string;
  // The PCM's sample rate while streaming; null for a file.
  sampleRate: number | null;
  model: string;
}

async function readLimited(response: Response, limit: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error('too large');
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

// The server's stream passed on as it comes, cut off (an error) past `limit` bytes, and with an
// even number of bytes per chunk carried over (a sample is two bytes; a chunk may split one).
export function limitedPcm(
  body: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  let size = 0;
  let odd: number | null = null;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) {
          controller.error(new Error('too large'));
          return;
        }
        let bytes = chunk;
        if (odd !== null) {
          const joined = new Uint8Array(chunk.byteLength + 1);
          joined[0] = odd;
          joined.set(chunk, 1);
          bytes = joined;
          odd = null;
        }
        if (bytes.byteLength % 2 === 1) {
          odd = bytes[bytes.byteLength - 1]!;
          bytes = bytes.subarray(0, bytes.byteLength - 1);
        }
        if (bytes.byteLength > 0) controller.enqueue(bytes);
      },
    }),
  );
}

// The language names speech models take (Qwen3-TTS: "German"), from the page's ISO code.
const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

// One seed for every sentence: a sampling TTS draws its voice anew per request, and the same
// seed keeps one answer (and the next) in one voice.
const SPEECH_SEED = 7;

export async function synthesize(input: {
  text: string;
  language?: string | null;
}): Promise<SpeechAudio> {
  if (input.text.length > VOICE_LIMITS.maxSpeechChars)
    throw new HttpError(
      413,
      `At most ${VOICE_LIMITS.maxSpeechChars} characters at a time`,
      'voice-too-long',
    );
  const route = await requireRoute(SPEECH_CLASS);
  const [key, settings] = await Promise.all([
    readModelServerKey(route.server),
    readVoiceSettings(),
  ]);
  const text =
    input.language?.startsWith('de') || !input.language
      ? ttsText(input.text, settings.pronunciationLexicon)
      : input.text.replace(/\s+/g, ' ').trim();
  if (!text) throw new HttpError(400, 'Nothing to say', 'voice-empty');
  const audioCaps = serverType(route.server.kind)?.audio;
  const pcmRate = audioCaps?.speechPcmRate ?? null;
  const language = input.language ? LANGUAGE_NAMES[input.language] : undefined;
  // PCM where the server streams it: the first words play while the rest is generated. WAV
  // otherwise — the one container every Lemonade speech backend encodes and every browser
  // decodes.
  const body = {
    model: route.model,
    input: text,
    response_format: pcmRate ? 'pcm' : 'wav',
    ...(settings.voice && { voice: settings.voice }),
    ...(settings.speed !== 1 && { speed: settings.speed }),
    ...(audioCaps?.speechLanguage && language && { language }),
    ...(pcmRate && { seed: SPEECH_SEED }),
  };
  let response: Response;
  try {
    response = await fetch(joinUrl(route.server.baseUrl, '/audio/speech'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorization(key) },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'The local voice did not answer', 'voice-local-failed');
  }
  if (!response.ok)
    throw new HttpError(
      502,
      `The local voice failed (HTTP ${response.status})`,
      'voice-local-failed',
    );
  if (pcmRate) {
    if (!response.body)
      throw new HttpError(502, 'The local voice answered no audio', 'voice-local-failed');
    return {
      audio: limitedPcm(response.body, MAX_SPEECH_BYTES),
      contentType: 'audio/pcm',
      sampleRate: pcmRate,
      model: route.modelId,
    };
  }
  const contentType = (response.headers.get('content-type') ?? 'audio/wav').split(';')[0]!.trim();
  if (!/^audio\/[\w.+-]+$/.test(contentType))
    throw new HttpError(502, 'The local voice answered no audio', 'voice-local-failed');
  let audio: ArrayBuffer;
  try {
    audio = await readLimited(response, MAX_SPEECH_BYTES);
  } catch {
    throw new HttpError(502, 'The local voice answered too much audio', 'voice-local-failed');
  }
  if (audio.byteLength === 0)
    throw new HttpError(502, 'The local voice answered no audio', 'voice-local-failed');
  return { audio, contentType, sampleRate: null, model: route.modelId };
}

// The voices the speech server of "Vorlesen" offers, for the owner to pick one; empty when the
// class has no local server or the server lists none.
export async function speechVoices(): Promise<string[]> {
  const routed = await routeOf(SPEECH_CLASS);
  if (!('route' in routed)) return [];
  const type = serverType(routed.route.server.kind);
  if (!type?.voices) return [];
  const key = await readModelServerKey(routed.route.server);
  try {
    return await type.voices(serverContext(routed.route.server, key, 5_000));
  } catch {
    return [];
  }
}

// ── How much one person may ask for ──────────────────────────────────────────────────────

interface Window {
  startedAt: number;
  count: number;
  active: number;
}

export interface VoiceQuota {
  perWindow: number;
  concurrent: number;
  windowMs: number;
}

export const QUOTAS: Record<'transcribe' | 'speak', VoiceQuota> = {
  // A conversation turn every few seconds for ten minutes, one or two at a time.
  transcribe: { perWindow: 200, concurrent: 2, windowMs: 10 * 60_000 },
  // A long answer read sentence by sentence, the next ones fetched ahead.
  speak: { perWindow: 1_000, concurrent: 4, windowMs: 10 * 60_000 },
};

const windows = new Map<string, Window>();

// Takes one request of the person's quota and returns its release; a 429 when the quota is
// used up. Kept in memory: a restart forgets it, which only ever lets someone ask more.
export function acquireVoice(
  kind: keyof typeof QUOTAS,
  userId: string,
  now = Date.now(),
): () => void {
  const quota = QUOTAS[kind];
  const key = `${kind}\0${userId}`;
  for (const [entry, value] of windows) {
    if (value.active === 0 && now - value.startedAt >= quota.windowMs) windows.delete(entry);
  }
  let window = windows.get(key);
  if (!window || now - window.startedAt >= quota.windowMs) {
    window = { startedAt: now, count: 0, active: window?.active ?? 0 };
    windows.set(key, window);
  }
  if (window.active >= quota.concurrent || window.count >= quota.perWindow)
    throw new HttpError(429, 'Too many voice requests; try again shortly', 'voice-busy');
  window.count += 1;
  window.active += 1;
  const held = window;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.active = Math.max(0, held.active - 1);
  };
}

export function resetVoiceQuotas(): void {
  windows.clear();
}
