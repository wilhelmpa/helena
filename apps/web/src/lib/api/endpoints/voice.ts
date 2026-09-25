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
  limits: { maxSeconds: number; maxBytes: number; maxSpeechChars: number };
}

export interface Transcription {
  text: string;
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

// A sentence as audio from Helena's local voice.
export async function speakText(text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${API_URL}/voice/speech`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw await apiFailure(res);
  return res.blob();
}
