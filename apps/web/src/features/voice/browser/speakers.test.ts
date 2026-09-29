import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { createLocalSpeaker } from './speakers';

const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext);
  else Reflect.deleteProperty(globalThis, 'AudioContext');
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

it('renders each local preface once and reuses its audio when queued', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  class FakeContext {
    destination = {};
    currentTime = 0;
    createBuffer(_channels: number, length: number, rate: number) {
      return { duration: length / rate, copyToChannel() {} };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {}, stop() {}, onended: null };
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  let requests = 0;
  const speaker = createLocalSpeaker({ onStart() {}, onIdle() {} }, async () => {
    requests += 1;
    return new Response(new Uint8Array(4800), {
      headers: { 'content-type': 'audio/pcm', 'x-helena-sample-rate': '24000' },
    });
  });
  speaker.preload(['Ich schau kurz nach.']);
  speaker.preload(['Ich schau kurz nach.']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  speaker.enqueue('Ich schau kurz nach.');
  assert.equal(requests, 1);
  speaker.destroy();
});
