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

function installAudioContext() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  class FakeContext {
    destination = {};
    currentTime = 0;
    createBuffer(_channels: number, length: number, rate: number) {
      let samples = new Float32Array(length);
      return {
        duration: length / rate,
        sampleRate: rate,
        copyToChannel(data: Float32Array) {
          samples = data;
        },
        getChannelData() {
          return samples;
        },
      };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {}, stop() {}, onended: null };
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
}

it('renders each local preface once and reuses its audio when queued', async () => {
  installAudioContext();
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

it('warms one preface at a time and gives answer sentences the next slots', async () => {
  installAudioContext();
  const requests: string[] = [];
  const finish: (() => void)[] = [];
  const speaker = createLocalSpeaker({ onStart() {}, onIdle() {} }, async (text) => {
    requests.push(text);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          finish.push(() => controller.close());
        },
      }),
      { headers: { 'content-type': 'audio/pcm', 'x-helena-sample-rate': '24000' } },
    );
  });
  speaker.preload(Array.from({ length: 10 }, (_, i) => `Preface ${i}`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, ['Preface 0']);
  for (let i = 0; i < 5; i += 1) speaker.enqueue(`Answer ${i}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, ['Preface 0', 'Answer 0', 'Answer 1']);
  finish[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, ['Preface 0', 'Answer 0', 'Answer 1', 'Answer 2']);
  speaker.destroy();
  for (const close of finish.slice(1)) close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 4);
});

it('does not keep generating unused prefaces after the initial warmup', async () => {
  installAudioContext();
  const requests: string[] = [];
  const speaker = createLocalSpeaker({ onStart() {}, onIdle() {} }, async (text) => {
    requests.push(text);
    return new Response(new Uint8Array(4800), {
      headers: { 'content-type': 'audio/pcm', 'x-helena-sample-rate': '24000' },
    });
  });
  speaker.preload(Array.from({ length: 10 }, (_, i) => `Preface ${i}`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, ['Preface 0']);
  speaker.enqueue('Preface 7');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, ['Preface 0', 'Preface 7']);
  speaker.destroy();
});
