import { API_URL, apiFailure, request } from '@/lib/api/core/client';

// Voice in the chat (docs/helena-decisions/voice.md): where dictation and reading aloud run now,
// a recording to text and a sentence to audio on Helena's local AI (Lokale KI → Transkription,
// Vorlesen). The model server's key stays in the API.

export type VoiceMode = 'off' | 'prefer' | 'only';

export interface VoicePath {
  mode: VoiceMode;
  // Whether Helena sends the work to a local model right now.
  local: boolean;
  reason: string | null;
  model: string | null;
}

export interface VoiceStatus {
  transcription: VoicePath;
  speech: VoicePath;
  // What the browser applies itself (absent from an older API).
  settings?: {
    pauseMs: number;
    speed: number;
    immediateResponse: boolean;
    bridgeEnabled: boolean;
    progressEnabled: boolean;
    readFullAnswers: boolean;
    fallbackTimeoutMs: number;
  };
  limits: { maxSeconds: number; maxBytes: number; maxSpeechChars: number };
}

export interface Transcription {
  text: string;
  // Why the text is empty although something was heard.
  dropped?: 'no-speech' | 'hallucination' | 'other-language' | null;
  model: string;
  durationMs: number;
  latencyMs: number;
}

export const getVoiceStatus = () => request<VoiceStatus>('/voice');

// A 16 kHz mono WAV recording to text. `language` is the page's (ISO 639-1), so a short
// utterance is not mistaken for another language.
export async function transcribeRecording(
  wav: Blob,
  language: string | null,
  signal?: AbortSignal,
): Promise<Transcription> {
  const form = new FormData();
  form.append('file', wav, 'recording.wav');
  if (language) form.append('language', language);
  const res = await fetch(`${API_URL}/voice/transcriptions`, {
    method: 'POST',
    credentials: 'include',
    body: form,
    signal,
  });
  if (!res.ok) throw await apiFailure(res);
  return res.json();
}

// A sentence as audio from Helena's local voice: a WAV file, or raw 16-bit mono PCM
// (`audio/pcm`, its rate in `x-helena-sample-rate`) streamed as the server generates it. The
// response is handed over unread, so a stream can be played as it comes.
export async function speakText(
  text: string,
  language: string | null,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(`${API_URL}/voice/speech`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(language && /^[a-z]{2}$/.test(language) && { language }) }),
    signal,
  });
  if (!res.ok) throw await apiFailure(res);
  return res;
}

// The owner's voice settings (Lokale KI → Sprache; Administrator).
export interface VoiceSettings {
  // How long a pause ends a conversation turn (ms).
  pauseMs: number;
  immediateResponse: boolean;
  bridgeEnabled: boolean;
  progressEnabled: boolean;
  readFullAnswers: boolean;
  fallbackTimeoutMs: number;
  // Words the transcription should know, beyond Helena's own names.
  vocabulary: string[];
  vocabularyAliases: VocabularyAlias[] | null;
  suggestedAliases: VocabularyAlias[];
  // The local voice; null: the speech server's default.
  voice: string | null;
  speed: number;
  // The model agents answer spoken turns with; null: their usual one.
  replyModel: string | null;
  replyThinkingLevel: string | null;
  // Read only: the names Helena adds itself, the voices the speech server offers, the models
  // the agents offer.
  helenaWords: string[];
  voices: string[];
  replyModels: { id: string; name: string; thinkingLevels: string[] }[];
}

export interface VocabularyAlias {
  heard: string;
  written: string;
}

export type VoiceSettingsPatch = Partial<
  Pick<
    VoiceSettings,
    | 'pauseMs'
    | 'immediateResponse'
    | 'bridgeEnabled'
    | 'progressEnabled'
    | 'readFullAnswers'
    | 'fallbackTimeoutMs'
    | 'vocabulary'
    | 'vocabularyAliases'
    | 'voice'
    | 'speed'
    | 'replyModel'
    | 'replyThinkingLevel'
  >
>;

export const getVoiceSettings = () => request<VoiceSettings>('/god/voice/settings');

export const updateVoiceSettings = (patch: VoiceSettingsPatch) =>
  request<VoiceSettings>('/god/voice/settings', { method: 'PATCH', body: JSON.stringify(patch) });
