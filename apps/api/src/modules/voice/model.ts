import { t } from 'elysia';

const mode = t.Union([t.Literal('off'), t.Literal('prefer'), t.Literal('only')], {
  description:
    "The Lokale KI mode of the path's class. `off`: the browser's own engine. `prefer`: local " +
    "first, the browser's engine while local is down. `only`: local or nothing.",
});

const path = t.Object({
  mode,
  local: t.Boolean({ description: 'Whether Helena sends this work to a local model right now' }),
  reason: t.Nullable(
    t.String({
      description:
        'Why not: master-off, class-off, unit-off, no-server, server-down, no-model, ' +
        'eval-failed, not-registered',
    }),
  ),
  model: t.Nullable(t.String({ description: 'The local model, `helena-<slug>/<id>`' })),
});

export const VoiceStatusResponse = t.Object({
  transcription: path,
  speech: path,
  limits: t.Object({
    maxSeconds: t.Number({ description: 'The longest recording one request may carry' }),
    maxBytes: t.Number(),
    maxSpeechChars: t.Number({ description: 'The most text one speech request may carry' }),
  }),
});

export const transcriptionBody = t.Object({
  file: t.File({ description: 'The recording: uncompressed PCM WAV, ideally 16 kHz mono' }),
  language: t.Optional(
    t.String({ pattern: '^[a-z]{2}$', description: 'ISO 639-1, e.g. `de`; absent: detected' }),
  ),
});

export const TranscriptionResponse = t.Object({
  text: t.String({ description: 'What was said; empty when nothing was understood' }),
  model: t.String(),
  durationMs: t.Number(),
  latencyMs: t.Number(),
});

export const speechBody = t.Object({
  text: t.String({ minLength: 1, maxLength: 4000 }),
});
