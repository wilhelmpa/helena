import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { attachCodeTheme } from './codeTheme';

test('code-server receives the current mode and another request after its extension is ready', () => {
  const dom = new JSDOM('', { url: 'https://helena.example/' });
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const messages: unknown[] = [];
  const channels: Channel[] = [];
  class Channel {
    constructor() {
      channels.push(this);
    }
    onmessage?: (event: MessageEvent) => void;
    closed = false;
    postMessage(message: unknown) {
      messages.push(message);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.BroadcastChannel = Channel as unknown as typeof BroadcastChannel;
  try {
    const detach = attachCodeTheme('https://helena.example/code/', 'light');
    assert.deepEqual(messages, [{ type: 'theme', mode: 'light' }]);
    channels[0]!.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
    assert.deepEqual(messages[1], { type: 'theme', mode: 'light' });
    detach?.();
    assert.equal(channels[0]!.closed, true);
    const detachDark = attachCodeTheme('https://helena.example/code/', 'dark');
    assert.deepEqual(messages[2], { type: 'theme', mode: 'dark' });
    detachDark?.();
    assert.equal(attachCodeTheme('https://other.example/code/', 'dark'), undefined);
  } finally {
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
    dom.window.close();
  }
});
