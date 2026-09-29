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
  settings: t.Object({
    pauseMs: t.Number({ description: 'How long a pause ends a conversation turn (ms)' }),
    speed: t.Number({ description: 'How fast the local voice speaks (1 = normal)' }),
    immediateResponse: t.Boolean(),
    bridgeEnabled: t.Boolean(),
    progressEnabled: t.Boolean(),
    readFullAnswers: t.Boolean(),
    fallbackTimeoutMs: t.Number(),
  }),
  limits: t.Object({
    maxSeconds: t.Number({ description: 'The longest recording one request may carry' }),
    maxBytes: t.Number(),
    maxSpeechChars: t.Number({ description: 'The most text one speech request may carry' }),
  }),
});

export const transcriptionBody = t.Object({
  file: t.File({ description: 'The recording: uncompressed PCM WAV, ideally 16 kHz mono' }),
  language: t.Optional(
    t.String({
      pattern: '^[a-z]{2}$',
      description: 'Legacy client hint; the account locale selects the transcription language',
    }),
  ),
});

export const TranscriptionResponse = t.Object({
  text: t.String({ description: 'What was said; empty when nothing was understood' }),
  dropped: t.Nullable(
    t.Union([t.Literal('no-speech'), t.Literal('hallucination'), t.Literal('other-language')], {
      description:
        'Why the text is empty although something was heard: only noise, a line Whisper ' +
        'invents on silence, or another language than the one asked for',
    }),
  ),
  model: t.String(),
  durationMs: t.Number(),
  latencyMs: t.Number(),
});

export const speechBody = t.Object({
  text: t.String({ minLength: 1, maxLength: 4000 }),
  language: t.Optional(
    t.String({ pattern: '^[a-z]{2}$', description: 'ISO 639-1 of the text, e.g. `de`' }),
  ),
});

const settingsFields = {
  pauseMs: t.Number({ minimum: 300, maximum: 2000, description: 'Pause that ends a turn (ms)' }),
  immediateResponse: t.Boolean(),
  bridgeEnabled: t.Boolean(),
  progressEnabled: t.Boolean(),
  readFullAnswers: t.Boolean(),
  fallbackTimeoutMs: t.Number({ minimum: 300, maximum: 5000 }),
  vocabulary: t.Array(t.String({ minLength: 1, maxLength: 60 }), {
    maxItems: 60,
    description: 'Words the transcription should know (names, products, terms)',
  }),
  vocabularyAliases: t.Nullable(
    t.Array(
      t.Object({
        heard: t.String({ minLength: 1, maxLength: 60 }),
        written: t.String({ minLength: 1, maxLength: 60 }),
      }),
      { maxItems: 60 },
    ),
  ),
  voice: t.Nullable(
    t.String({ maxLength: 120, description: "The local voice; null: the server's" }),
  ),
  speed: t.Number({ minimum: 0.7, maximum: 1.4 }),
  pronunciationLexicon: t.Array(
    t.Object({
      word: t.String({ minLength: 1, maxLength: 60 }),
      pronunciation: t.String({ minLength: 1, maxLength: 60 }),
    }),
    { maxItems: 100, description: 'Additional or overriding pronunciations for speech' },
  ),
  replyModel: t.Nullable(
    t.String({
      maxLength: 200,
      description: 'The model an agent answers spoken turns with; null: its usual one',
    }),
  ),
  replyThinkingLevel: t.Nullable(t.String({ maxLength: 40 })),
};

export const VoiceSettingsResponse = t.Object({
  ...settingsFields,
  defaultPronunciations: t.Array(t.Object({ word: t.String(), pronunciation: t.String() })),
  suggestedAliases: t.Array(t.Object({ heard: t.String(), written: t.String() })),
  helenaWords: t.Array(t.String(), {
    description: 'The names Helena adds to the vocabulary itself (agents, projects)',
  }),
  voices: t.Array(t.String(), { description: 'The voices the local speech server offers' }),
  replyModels: t.Array(
    t.Object({ id: t.String(), name: t.String(), thinkingLevels: t.Array(t.String()) }),
    { description: 'The models the agents offer, for spoken turns' },
  ),
});

export const voiceSettingsBody = t.Partial(t.Object(settingsFields));
