import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoicePath, VoiceStatus } from '@/lib/api/endpoints/voice';
import { pickListener, pickSpeaker, type BrowserVoice } from './voiceEngine';

const chrome: BrowserVoice = { secure: true, recognition: true, recorder: true, synthesis: true };
const firefox: BrowserVoice = { secure: true, recognition: false, recorder: true, synthesis: true };
const onHttp: BrowserVoice = { ...chrome, secure: false };

const path = (fields: Partial<VoicePath>): VoicePath => ({
  mode: 'off',
  local: false,
  reason: 'class-off',
  model: null,
  ...fields,
});

function status(transcription: Partial<VoicePath>, speech: Partial<VoicePath> = {}): VoiceStatus {
  return {
    transcription: path(transcription),
    speech: path(speech),
    limits: { maxSeconds: 120, maxBytes: 12_582_912, maxSpeechChars: 1000 },
  };
}

const local = { mode: 'prefer' as const, local: true, reason: null, model: 'helena-local/w' };
const down = { mode: 'prefer' as const, local: false, reason: 'server-down' };

describe('pickListener', () => {
  it('needs a secure page, whatever the engine', () => {
    assert.deepEqual(pickListener(status(local), onHttp), { engine: 'none', blocker: 'insecure' });
    assert.deepEqual(pickListener(null, onHttp), { engine: 'none', blocker: 'insecure' });
  });

  it('records for the local model while it takes the work', () => {
    assert.deepEqual(pickListener(status(local), chrome), { engine: 'local' });
    // Firefox has no recognition of its own, but records.
    assert.deepEqual(pickListener(status(local), firefox), { engine: 'local' });
    assert.deepEqual(pickListener(status({ ...local, mode: 'only' }), chrome), {
      engine: 'local',
    });
  });

  it("uses the browser's recognition while Transkription is off or local is down", () => {
    assert.deepEqual(pickListener(status({}), chrome), { engine: 'browser' });
    assert.deepEqual(pickListener(status(down), chrome), { engine: 'browser' });
    assert.deepEqual(pickListener(null, chrome), { engine: 'browser' });
    assert.deepEqual(pickListener(status({}), firefox), { engine: 'none', blocker: 'unsupported' });
  });

  it('never falls back to the browser with "Nur lokal"', () => {
    assert.deepEqual(pickListener(status({ ...down, mode: 'only' }), chrome), {
      engine: 'none',
      blocker: 'local-only-down',
    });
  });
});

describe('pickSpeaker', () => {
  it("uses Helena's voice while Vorlesen is local, else the browser's", () => {
    assert.deepEqual(pickSpeaker(status({}, local), chrome), {
      engine: 'local',
      fallback: 'browser',
    });
    assert.deepEqual(pickSpeaker(status({}, { ...local, mode: 'only' }), chrome), {
      engine: 'local',
      fallback: null,
    });
    assert.deepEqual(pickSpeaker(status({}, {}), chrome), { engine: 'browser' });
    assert.deepEqual(pickSpeaker(status({}, down), onHttp), { engine: 'browser' });
    assert.deepEqual(pickSpeaker(status({}, { ...down, mode: 'only' }), chrome), {
      engine: 'none',
    });
    assert.deepEqual(pickSpeaker(null, { ...chrome, synthesis: false }), { engine: 'none' });
  });
});
