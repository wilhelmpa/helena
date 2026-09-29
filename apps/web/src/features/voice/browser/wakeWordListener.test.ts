import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { startWakeWordListener } from './wakeWordListener';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

describe('local wake listener', () => {
  it('never starts a recognition service when local processing is unavailable', async () => {
    let constructed = 0;
    class RemoteOnly {
      static async available() {
        return 'downloadable';
      }
      constructor() {
        constructed += 1;
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { SpeechRecognition: RemoteOnly },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { lang: 'de' } },
    });
    const states: string[] = [];
    await startWakeWordListener({ onStatus: (state) => states.push(state), onWake: () => {} });
    assert.equal(constructed, 0);
    assert.deepEqual(states, ['unavailable']);
  });

  it('forces local processing and hands the first sentence to the conversation', async () => {
    const instances: LocalRecognition[] = [];
    let availability: unknown;
    class LocalRecognition {
      static async available(options: unknown) {
        availability = options;
        return 'available';
      }
      processLocally = false;
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      started = false;
      aborted = false;
      constructor() {
        instances.push(this);
      }
      start() {
        this.started = true;
      }
      abort() {
        this.aborted = true;
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { ...globalThis, SpeechRecognition: LocalRecognition },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { lang: 'de' } },
    });
    const wakes: string[] = [];
    const stop = await startWakeWordListener({
      onStatus: () => {},
      onWake: (text) => wakes.push(text),
    });
    const recognition = instances[0]!;
    assert.deepEqual(availability, { langs: ['de-DE'], processLocally: true });
    assert.ok(recognition);
    assert.equal(recognition.processLocally, true);
    assert.equal(recognition.started, true);
    recognition.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'Aber das ist Eva' } }],
    });
    assert.deepEqual(wakes, []);
    recognition.onresult?.({
      results: [
        { isFinal: true, 0: { transcript: 'Aber das ist Eva' } },
        { isFinal: true, 0: { transcript: 'Eywa, erzähl mir etwas' } },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 950));
    assert.deepEqual(wakes, ['erzähl mir etwas']);
    assert.equal(recognition.aborted, true);
    stop();
  });
});
