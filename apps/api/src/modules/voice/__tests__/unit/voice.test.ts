import { beforeEach, describe, expect, it } from 'bun:test';
import { HttpError } from '#shared/lib';
import { capabilitiesFromId } from '#modules/local-ai/server-types';
import { cleanTranscript } from '../../transcript';
import { readWav } from '../../wav';
import { QUOTAS, acquireVoice, resetVoiceQuotas } from '../../service';
import { wav } from '../fixtures';

// The voice module's pure parts (docs/helena-decisions/voice.md): what a WAV upload is, which
// Whisper answers count as nothing, how much one person may ask for, and which models of a plain
// OpenAI-compatible server are speech models.

describe('readWav', () => {
  it('reads the format and the exact duration of 16 kHz mono PCM', () => {
    expect(readWav(wav(2.5))).toEqual({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 80000,
      durationMs: 2500,
    });
  });

  it('reads 48 kHz stereo and skips chunks it does not know', () => {
    const plain = wav(1, { rate: 48000, channels: 2 });
    // A LIST chunk of 5 bytes (padded to 6) between fmt and data.
    const extra = new Uint8Array(plain.length + 14);
    extra.set(plain.subarray(0, 36), 0);
    const view = new DataView(extra.buffer);
    [...'LIST'].forEach((char, index) => view.setUint8(36 + index, char.charCodeAt(0)));
    view.setUint32(40, 5, true);
    extra.set(plain.subarray(36), 50);
    expect(readWav(extra)?.durationMs).toBe(1000);
    expect(readWav(extra)?.channels).toBe(2);
  });

  it('refuses what is not uncompressed PCM in a whole RIFF/WAVE file', () => {
    expect(readWav(new Uint8Array(10))).toBeNull();
    expect(readWav(new TextEncoder().encode('x'.repeat(100)))).toBeNull();
    // IEEE float and a compressed format.
    expect(readWav(wav(1, { format: 3, bits: 32 }))).toBeNull();
    expect(readWav(wav(1, { format: 85 }))).toBeNull();
    // A data chunk longer than the file (truncated upload).
    expect(readWav(wav(1).subarray(0, 1000))).toBeNull();
    // Out of range.
    expect(readWav(wav(1, { rate: 96000 }))).toBeNull();
    expect(readWav(wav(0.1, { channels: 6 }))).toBeNull();
  });
});

describe('cleanTranscript', () => {
  it('keeps what was said, trimmed', () => {
    expect(cleanTranscript('  Hallo Home,\n wie spät ist es?  ')).toBe(
      'Hallo Home, wie spät ist es?',
    );
    expect(cleanTranscript('Vielen Dank.')).toBe('Vielen Dank.');
    expect(cleanTranscript('Schreib dem ZDF eine Mail zu den Untertiteln.')).toBe(
      'Schreib dem ZDF eine Mail zu den Untertiteln.',
    );
  });

  it("drops Whisper's subtitle credits and sound labels on silence", () => {
    for (const hallucination of [
      'Untertitel im Auftrag des ZDF für funk, 2017',
      'Untertitel im Auftrag des ZDF, 2020',
      'Untertitelung des ZDF, 2020',
      'Untertitel der Amara.org-Community',
      'Vielen Dank fürs Zuschauen!',
      'Thank you for watching.',
      '[Musik]',
      '(Applaus)',
      '*lacht*',
      '♪ ♪',
      '   ',
    ]) {
      expect(cleanTranscript(hallucination)).toBe('');
    }
  });

  it('cuts at the limit', () => {
    expect(cleanTranscript('a'.repeat(50), 10)).toBe('a'.repeat(10));
  });
});

describe('acquireVoice', () => {
  beforeEach(resetVoiceQuotas);

  it('allows a few at a time and releases them', () => {
    const { concurrent } = QUOTAS.transcribe;
    const releases = Array.from({ length: concurrent }, () => acquireVoice('transcribe', 'u1'));
    expect(() => acquireVoice('transcribe', 'u1')).toThrow(HttpError);
    // Another person is not affected.
    acquireVoice('transcribe', 'u2')();
    releases[0]!();
    releases[0]!();
    acquireVoice('transcribe', 'u1')();
  });

  it('refuses beyond the window and starts over after it', () => {
    const { perWindow, windowMs } = QUOTAS.transcribe;
    const now = 1_000_000;
    for (let index = 0; index < perWindow; index += 1) acquireVoice('transcribe', 'u1', now)();
    let refused: unknown = null;
    try {
      acquireVoice('transcribe', 'u1', now + 1);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(429);
    expect((refused as HttpError).code).toBe('voice-busy');
    acquireVoice('transcribe', 'u1', now + windowMs)();
  });
});

describe('capabilitiesFromId', () => {
  it('finds speech models of a plain OpenAI-compatible server by their names', () => {
    expect(capabilitiesFromId('Systran/faster-whisper-large-v3')).toEqual(['transcription']);
    expect(capabilitiesFromId('whisper-v3-turbo-FLM')).toEqual(['transcription']);
    expect(capabilitiesFromId('nvidia/parakeet-tdt-0.6b-v3')).toEqual(['transcription']);
    expect(capabilitiesFromId('speaches-ai/piper-de_DE-thorsten-medium')).toEqual(['speech']);
    expect(capabilitiesFromId('kokoro-v1')).toEqual(['speech']);
    expect(capabilitiesFromId('OpenMOSS-TTS')).toEqual(['speech']);
    expect(capabilitiesFromId('Qwen3-Embedding-0.6B')).toEqual(['embeddings']);
    expect(capabilitiesFromId('Qwen3.6-35B-A3B-GGUF')).toEqual(['chat']);
    // "stt"/"tts" only as their own word.
    expect(capabilitiesFromId('mistral-small-instruct')).toEqual(['chat']);
  });
});
