import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConversationController, type ConversationDeps } from './conversationController';
import { conversationPhase } from '../utils/conversation';
import type { EarEvents } from './vadListener';
import type { SpeakerEvents, VoiceSpeaker } from './speakers';
import type { TurnTimings } from '../utils/turnTimings';

const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function harness(
  transcribe: ConversationDeps['transcribe'] = async () => ({ text: 'Hallo' }),
  audibleDelayMs = 0,
  bridgeDelayMs = 5,
  wakeText?: string,
) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { lang: 'de' } },
  });
  const spoken: string[] = [];
  const sent: string[] = [];
  const problems: string[] = [];
  const timings: TurnTimings[] = [];
  let ear: EarEvents | null = null;
  let speaker: VoiceSpeaker | null = null;
  let speakerEvents: SpeakerEvents | null = null;
  const controller = new ConversationController({
    onState: () => {},
    onHeard: () => {},
    onLevel: () => {},
    onProblem: (problem) => problems.push(problem),
    send: (text) => sent.push(text),
    transcribe,
    refreshStatus: () => {},
    onTimings: (value) => timings.push(value),
    bridgeDelayMs,
    openEar: async (events) => {
      ear = events;
      return { pauseMs: 460, setGuarded: () => {}, destroy: async () => {} };
    },
    speakerFactory: (_engine, events: SpeakerEvents) => {
      if (_engine.engine === 'none') return null;
      speakerEvents = events;
      const queue: string[] = [];
      let paused = false;
      speaker = {
        engine: _engine.engine,
        enqueue(text) {
          queue.push(text);
          spoken.push(text);
          if (queue.length === 1) events.onStart();
          if (audibleDelayMs)
            setTimeout(() => {
              if (!paused && queue.includes(text)) events.onAudible?.();
            }, audibleDelayMs);
          else if (!paused) events.onAudible?.();
        },
        pause() {
          paused = true;
        },
        resume() {
          paused = false;
          events.onAudible?.();
        },
        clear() {
          queue.length = 0;
          events.onIdle();
        },
        drain() {
          const rest = [...queue];
          queue.length = 0;
          events.onIdle();
          return rest;
        },
        reading: () => queue.join(' '),
        busy: () => queue.length > 0,
        unlock: () => {},
        destroy: () => {
          queue.length = 0;
        },
      };
      return speaker;
    },
  });
  controller.setEngines({ engine: 'local' }, { engine: 'local', fallback: 'browser' });
  controller.start([], false, wakeText);
  const ready = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const utter = (text: string | Float32Array) => {
    assert.ok(ear);
    ear.onSpeechStart();
    ear.onUtterance(
      text instanceof Float32Array ? text : null,
      typeof text === 'string' ? text : null,
    );
  };
  return {
    controller,
    spoken,
    sent,
    problems,
    timings,
    ready,
    utter,
    get speaker() {
      return speaker;
    },
    failVoice(text: string) {
      speakerEvents?.onError?.(text, new Error('fake TTS outage'));
    },
  };
}

describe('conversation controller with fake ear and speaker', () => {
  it('sends the sentence following Ava as the first turn', async () => {
    const h = harness(async () => ({ text: 'unused' }), 0, 5, 'mach das Licht an');
    await h.ready();
    assert.deepEqual(h.sent, ['mach das Licht an']);
  });

  it('bridges once, streams the first sentence, then listens after the final audio', async () => {
    const h = harness();
    await h.ready();
    h.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.deepEqual(h.spoken, ['Moment …']);
    assert.deepEqual(h.sent, ['Hallo']);
    h.controller.update(
      [{ id: 'a', role: 'assistant', text: 'Hallo. Der Rest entsteht' }],
      true,
      0,
    );
    assert.deepEqual(h.spoken, ['Moment …', 'Hallo.']);
    assert.equal(h.timings[0]?.firstSoundKind, 'bridge');
    assert.ok((h.timings[0]?.firstSoundMs ?? Infinity) < 1000);
    assert.equal(h.controller.snapshot.waiting, false);
    h.controller.update(
      [{ id: 'a', role: 'assistant', text: 'Hallo. Der Rest entsteht jetzt.' }],
      false,
      0,
    );
    assert.equal(h.spoken.at(-1), 'Der Rest entsteht jetzt.');
    h.speaker?.clear();
    assert.equal(h.controller.snapshot.active, 'on');
    assert.equal(h.controller.snapshot.speaking, false);
    h.controller.stop();
  });

  it('does not repeat a bridge before a real audible answer and honors the off switch', async () => {
    const h = harness();
    await h.ready();
    h.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 12));
    h.speaker?.clear();
    h.utter('Noch etwas');
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.deepEqual(h.spoken, ['Moment …']);
    h.controller.stop();

    const disabled = harness();
    await disabled.ready();
    disabled.controller.configure({ bridgeEnabled: false });
    disabled.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.deepEqual(disabled.spoken, []);
    disabled.controller.stop();
  });

  it('stays under one second with a simulated 300 ms first-audio delay', async () => {
    const h = harness(undefined, 300, 120);
    await h.ready();
    const before = performance.getEntriesByName('volition-voice-first-tone').length;
    h.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const ended = performance.getEntriesByName('volition-voice-speech-ended').at(-1);
    const tone = performance.getEntriesByName('volition-voice-first-tone')[before];
    assert.ok(ended && tone);
    assert.ok(tone.startTime - ended.startTime < 1000);
    h.controller.stop();
  });

  it('skips the bridge for a prompt first sentence and speaks chat details briefly', async () => {
    const fast = harness(undefined, 0, 50);
    await fast.ready();
    fast.utter('Hallo');
    fast.controller.update([{ id: 'a', role: 'assistant', text: 'Hallo. Weiter' }], true, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(fast.spoken, ['Hallo.']);
    fast.controller.stop();

    const detailed = harness();
    await detailed.ready();
    detailed.controller.configure({ bridgeEnabled: false });
    detailed.utter('Zeig die Tabelle');
    detailed.controller.update(
      [{ id: 'b', role: 'assistant', text: '| Name | Wert |\n| --- | --- |\n| A | 1 |' }],
      false,
      0,
    );
    assert.deepEqual(detailed.spoken, ['Die Details stehen im Chat.']);
    detailed.controller.stop();
  });

  it('stops sound on a spoken Stopp and recovers from STT failure', async () => {
    const h = harness();
    await h.ready();
    h.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 12));
    const ear = h.speaker;
    if (!ear) throw new Error('Fake speaker was not created');
    assert.ok(ear.busy());
    h.utter('Stopp');
    assert.equal(h.controller.snapshot.active, 'off');
    assert.equal(ear.busy(), false);
    h.controller.stop();

    const failed = harness(async () => {
      throw new Error('fake STT outage');
    });
    await failed.ready();
    failed.utter(new Float32Array(5000).fill(0.2));
    await failed.ready();
    assert.deepEqual(failed.problems, ['transcribe-failed']);
    assert.equal(failed.controller.snapshot.active, 'on');
    failed.controller.stop();
  });

  it('shows a TTS error, keeps text in chat, and accepts another turn', async () => {
    const h = harness();
    await h.ready();
    h.controller.setEngines({ engine: 'local' }, { engine: 'local', fallback: null });
    h.utter('Hallo');
    await new Promise((resolve) => setTimeout(resolve, 12));
    h.failVoice('Moment …');
    assert.deepEqual(h.problems, ['voice-failed']);
    assert.equal(conversationPhase(h.controller.snapshot), 'error');
    h.controller.update([{ id: 'a', role: 'assistant', text: 'Antwort als Text.' }], false, 0);
    assert.deepEqual(h.spoken, ['Moment …']);
    h.utter('Neue Frage');
    assert.equal(h.controller.snapshot.active, 'on');
    assert.equal(h.controller.snapshot.error, false);
    h.controller.stop();
  });
});
