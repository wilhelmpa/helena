import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openMicrophoneAnalyser, orbAudioFrame } from '@/utils/voiceOrbAudio';
import { createLocalSpeaker } from './speakers';

describe('voice orb audio', () => {
  it('maps silence, speech level and three spectral bands into bounded orb values', () => {
    assert.deepEqual(orbAudioFrame(new Uint8Array(8).fill(128), new Uint8Array(24)), {
      level: 0,
      bands: [0, 0, 0],
    });
    const frequencies = new Uint8Array(512);
    frequencies[2] = 90;
    frequencies[10] = 180;
    frequencies[100] = 255;
    const frame = orbAudioFrame(new Uint8Array([0, 255]), frequencies);
    assert.equal(frame.level, 1);
    assert.deepEqual(frame.bands, [0.5, 1, 1]);
  });

  const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  afterEach(() => {
    if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });

  it('disconnects the microphone graph and closes its context without stopping the VAD stream', async () => {
    const calls: string[] = [];
    class FakeContext {
      createMediaStreamSource(stream: MediaStream) {
        assert.equal(stream, input);
        return {
          connect: () => calls.push('source.connect'),
          disconnect: () => calls.push('source.disconnect'),
        };
      }
      createAnalyser() {
        return { fftSize: 0, disconnect: () => calls.push('analyser.disconnect') };
      }
      close() {
        calls.push('context.close');
        return Promise.resolve();
      }
    }
    const input = {
      getTracks: () => [{ stop: () => calls.push('track.stop') }],
    } as unknown as MediaStream;
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
    const meter = openMicrophoneAnalyser(input);
    await meter.close();
    assert.deepEqual(calls, [
      'source.connect',
      'source.disconnect',
      'analyser.disconnect',
      'context.close',
    ]);
  });

  it('routes local TTS through an analyser and closes it with the speaker', () => {
    const calls: string[] = [];
    const seen: (AnalyserNode | null)[] = [];
    const analyser = {
      fftSize: 0,
      connect: () => calls.push('analyser.connect'),
      disconnect: () => calls.push('analyser.disconnect'),
    } as unknown as AnalyserNode;
    class FakeContext {
      destination = {};
      createAnalyser() {
        return analyser;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        calls.push('context.close');
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
    const speaker = createLocalSpeaker({
      onStart() {},
      onIdle() {},
      onAnalyser: (node) => seen.push(node),
    });
    speaker.unlock();
    speaker.destroy();
    assert.deepEqual(seen, [analyser, null]);
    assert.deepEqual(calls, ['analyser.connect', 'analyser.disconnect', 'context.close']);
  });
});
