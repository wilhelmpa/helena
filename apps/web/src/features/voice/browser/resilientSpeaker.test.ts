import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createResilientSpeaker, type SpeakerEvents, type VoiceSpeaker } from './speakers';
import { setVoiceFallback, voiceFallbackActive } from './voiceFallback';

// A stand-in for one voice engine: plays queued pieces one per tick, tells what it heard, and
// fails a piece where `fails(text, attempt)` says (the way the local voice reports a failed
// piece and goes on to the next).
function fakeVoice(
  engine: 'local' | 'browser',
  events: SpeakerEvents,
  log: string[],
  fails: (text: string, attempt: number) => boolean = () => false,
): VoiceSpeaker {
  const queue: string[] = [];
  const attempts = new Map<string, number>();
  let running = false;
  const step = () => {
    const text = queue[0];
    if (text === undefined) {
      running = false;
      events.onIdle();
      return;
    }
    const attempt = (attempts.get(text) ?? 0) + 1;
    attempts.set(text, attempt);
    queue.shift();
    if (fails(text, attempt)) {
      log.push(`${engine}:fail:${text}`);
      events.onError?.(text, new Error('outage'));
    } else {
      log.push(`${engine}:${text}`);
      events.onAudible?.(text);
    }
    setTimeout(step, 0);
  };
  return {
    engine,
    enqueue(text) {
      queue.push(text);
      if (running) return;
      running = true;
      events.onStart();
      setTimeout(step, 0);
    },
    preload() {},
    pause() {},
    resume() {},
    clear() {
      queue.length = 0;
      running = false;
      events.onIdle();
    },
    drain() {
      const rest = [...queue];
      queue.length = 0;
      running = false;
      events.onIdle();
      return rest;
    },
    reading: () => queue.join(' '),
    busy: () => running || queue.length > 0,
    unlock() {},
    destroy() {
      queue.length = 0;
      running = false;
    },
  };
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(
  speaker: Parameters<typeof createResilientSpeaker>[1]['speaker'],
  localFails?: (text: string, attempt: number) => boolean,
) {
  const log: string[] = [];
  const seen = { starts: 0, idles: 0, errors: [] as string[], fallbacks: [] as boolean[] };
  const made = { local: 0, browser: 0 };
  const events: SpeakerEvents = {
    onStart: () => (seen.starts += 1),
    onIdle: () => (seen.idles += 1),
    onError: (text) => seen.errors.push(text),
  };
  const voice = createResilientSpeaker(events, {
    speaker,
    retryDelaysMs: [1, 1],
    makeLocal: (inner) => {
      made.local += 1;
      return fakeVoice('local', inner, log, localFails);
    },
    makeBrowser: (inner) => {
      made.browser += 1;
      return fakeVoice('browser', inner, log);
    },
    onFallback: (active) => seen.fallbacks.push(active),
  });
  return { voice, log, seen, made };
}

afterEach(() => setVoiceFallback(false));

describe('the resilient voice', () => {
  it("asks Helena's voice again for a failed piece instead of changing voices", async () => {
    const { voice, log, seen, made } = setup(
      { engine: 'local', fallback: 'browser' },
      (text, attempt) => text === 'Zwei.' && attempt === 1,
    );
    voice.enqueue('Eins.');
    voice.enqueue('Zwei.');
    voice.enqueue('Drei.');
    await settle();
    assert.deepEqual(log, ['local:Eins.', 'local:fail:Zwei.', 'local:Zwei.', 'local:Drei.']);
    assert.equal(made.browser, 0);
    assert.deepEqual(seen.errors, []);
    assert.deepEqual(seen.fallbacks, []);
    assert.equal(voiceFallbackActive(), false);
    // Listeners hear one turn: no idle between the failed piece and its retry.
    assert.equal(seen.starts, 1);
    assert.equal(seen.idles, 1);
  });

  it("reads with the browser's voice only once Helena's stays unreachable, and says so", async () => {
    const { voice, log, seen, made } = setup(
      { engine: 'local', fallback: 'browser' },
      (text) => text !== 'Zurück.',
    );
    voice.enqueue('Eins.');
    voice.enqueue('Zwei.');
    await settle(80);
    // Tried on Helena's voice three times (once plus two retries), then the browser reads on.
    assert.equal(log.filter((entry) => entry === 'local:fail:Eins.').length, 3);
    assert.deepEqual(
      log.filter((entry) => entry.startsWith('browser:')),
      ['browser:Eins.', 'browser:Zwei.'],
    );
    assert.equal(made.browser, 1);
    assert.deepEqual(seen.errors, []);
    assert.deepEqual(seen.fallbacks, [true]);
    assert.equal(voiceFallbackActive(), true);
    // The next answer goes back to Helena's voice.
    voice.renew?.();
    assert.deepEqual(seen.fallbacks, [true, false]);
    assert.equal(voiceFallbackActive(), false);
    voice.enqueue('Zurück.');
    await settle();
    assert.equal(log.at(-1), 'local:Zurück.');
    assert.equal(made.browser, 1);
  });

  it("keeps to Helena's voice and reports the failure where the browser is no fallback", async () => {
    const { voice, log, seen, made } = setup(
      { engine: 'local', fallback: null },
      (text) => text !== 'Später.',
    );
    voice.enqueue('Eins.');
    voice.enqueue('Zwei.');
    await settle(80);
    assert.equal(made.browser, 0);
    assert.deepEqual(seen.errors, ['Eins.']);
    assert.equal(log.filter((entry) => entry.startsWith('browser:')).length, 0);
    assert.equal(voiceFallbackActive(), false);
    voice.enqueue('Später.');
    await settle();
    assert.equal(log.at(-1), 'local:Später.');
  });

  it("uses the browser's voice alone when nothing local is chosen and never builds Helena's", async () => {
    const { voice, log, made } = setup({ engine: 'browser' });
    voice.enqueue('Hallo.');
    await settle();
    assert.deepEqual(log, ['browser:Hallo.']);
    assert.equal(made.local, 0);
    assert.equal(voiceFallbackActive(), false);
  });

  it('gives back what is still to read when it is emptied', async () => {
    const { voice } = setup({ engine: 'local', fallback: 'browser' }, () => true);
    voice.enqueue('Eins.');
    voice.enqueue('Zwei.');
    await settle(4);
    assert.ok(voice.busy());
    const rest = voice.drain();
    assert.ok(rest.length > 0);
    assert.equal(voice.busy(), false);
  });
});
