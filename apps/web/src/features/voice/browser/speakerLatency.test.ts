import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { createLocalSpeaker, type VoiceSpeaker } from './speakers';
const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext);
  else Reflect.deleteProperty(globalThis, 'AudioContext');
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
function audio() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  const sources: { onended: (() => void) | null }[] = [];
  class Context {
    currentTime = 0;
    destination = {};
    createBuffer(_n: number, length: number, rate: number) {
      let data: Float32Array = new Float32Array(length);
      return {
        duration: length / rate,
        sampleRate: rate,
        copyToChannel(input: Float32Array) {
          data = input;
        },
        getChannelData() {
          return data;
        },
      };
    }
    createBufferSource() {
      const node = { onended: null, buffer: null, connect() {}, start() {}, stop() {} };
      sources.push(node);
      return node;
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  return sources;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const pcm = () =>
  new Response(new Int16Array(4800).fill(2000), {
    headers: { 'content-type': 'audio/pcm', 'x-helena-sample-rate': '24000' },
  });
it('warms the next selected bridge only after the answer, then reuses that audio', async () => {
  const sources = audio();
  const requested: string[] = [];
  const speaker = createLocalSpeaker({ onStart() {}, onIdle() {} }, async (text) => {
    requested.push(text);
    return pcm();
  });
  try {
    speaker.preload(['Bridge 0', 'Bridge 1', 'Unused']);
    await tick();
    speaker.enqueue('Answer');
    await tick();
    (speaker as VoiceSpeaker & { warm(text: string): void }).warm('Bridge 1');
    await tick();
    assert.deepEqual(requested, ['Bridge 0', 'Answer']);
    for (const source of [...sources]) source.onended?.();
    await tick();
    assert.deepEqual(requested, ['Bridge 0', 'Answer', 'Bridge 1']);
    speaker.enqueue('Bridge 1');
    await tick();
    assert.equal(requested.length, 3);
  } finally {
    speaker.destroy();
  }
});
it('retries a failed cached bridge with fresh audio on the next enqueue', async () => {
  audio();
  let attempts = 0;
  const speaker = createLocalSpeaker({ onStart() {}, onIdle() {} }, async () => {
    if (++attempts === 1) throw new Error('temporarily unavailable');
    return pcm();
  });
  try {
    speaker.preload(['Bridge']);
    await tick();
    speaker.enqueue('Bridge');
    await tick();
    assert.equal(attempts, 2);
    speaker.clear();
    speaker.enqueue('Bridge');
    await tick();
    assert.equal(attempts, 2);
  } finally {
    speaker.destroy();
  }
});
it('does not report leading silence as audible speech', async () => {
  audio();
  const audible: string[] = [];
  const speaker = createLocalSpeaker(
    { onStart() {}, onIdle() {}, onAudible: (text) => audible.push(text) },
    async () =>
      new Response(new Uint8Array(4800), {
        headers: { 'content-type': 'audio/pcm', 'x-helena-sample-rate': '24000' },
      }),
  );
  try {
    speaker.enqueue('Silent response');
    await new Promise((r) => setTimeout(r, 70));
    assert.deepEqual(audible, []);
  } finally {
    speaker.destroy();
  }
});
