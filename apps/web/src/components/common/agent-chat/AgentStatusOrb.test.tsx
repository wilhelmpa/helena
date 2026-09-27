import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import common from '../../../../messages/en/common.json';
import AgentStatusOrb from './AgentStatusOrb';

const globals = [
  'window',
  'document',
  'HTMLElement',
  'customElements',
  'AudioContext',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let previous: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;
let container: HTMLElement;
let motion: {
  matches: boolean;
  added: number;
  removed: number;
  addEventListener: () => void;
  removeEventListener: () => void;
};

async function render(node: React.ReactNode) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ common }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    customElements: { configurable: true, value: dom.window.customElements },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  motion = {
    matches: false,
    added: 0,
    removed: 0,
    addEventListener() {
      this.added++;
    },
    removeEventListener() {
      this.removed++;
    },
  };
  dom.window.matchMedia = () => motion as unknown as MediaQueryList;
  dom.window.requestAnimationFrame = () => 1;
  dom.window.cancelAnimationFrame = () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
    getExtension: () => null,
  })) as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
  container = document.querySelector('#root')!;
  const { createRoot } = await import('react-dom/client');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('large agent status orb', () => {
  it('stays static when reduced motion is requested', async () => {
    motion.matches = true;
    await render(<AgentStatusOrb state="thinking" size="large" />);
    assert.equal(container.querySelector('voice-orb'), null);
    assert.ok(container.querySelector('[aria-hidden="true"]'));
    assert.equal(motion.added, 1);
  });

  it('stays static when WebGL is unavailable', async () => {
    dom.window.HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof dom.window.HTMLCanvasElement.prototype.getContext;
    await render(<AgentStatusOrb state="waiting" size="large" />);
    assert.equal(container.querySelector('voice-orb'), null);
    assert.ok(container.querySelector('[aria-hidden="true"]'));
  });

  it('does not animate an offline agent', async () => {
    await render(<AgentStatusOrb state="idle" size="large" online={false} />);
    assert.equal(container.querySelector('voice-orb'), null);
    assert.equal(container.querySelector('[role="img"]')?.getAttribute('aria-label'), 'Offline');
    assert.equal(motion.added, 0);
  });

  it('disconnects the web component and motion listener on unmount', async () => {
    let disconnected = 0;
    class FakeOrb extends dom.window.HTMLElement {
      disconnectedCallback() {
        disconnected++;
      }
    }
    customElements.define('voice-orb', FakeOrb);
    await render(<AgentStatusOrb state="tool" size="large" />);
    assert.equal(container.querySelector('voice-orb')?.getAttribute('state'), 'thinking');
    await render(<span />);
    assert.equal(disconnected, 1);
    assert.equal(motion.removed, 1);
  });

  it('keeps one web component through status updates', async () => {
    let disconnected = 0;
    class FakeOrb extends dom.window.HTMLElement {
      disconnectedCallback() {
        disconnected++;
      }
    }
    customElements.define('voice-orb', FakeOrb);
    await render(<AgentStatusOrb state="idle" size="large" />);
    const orb = container.querySelector('voice-orb');
    await render(<AgentStatusOrb state="thinking" size="large" />);
    assert.equal(container.querySelector('voice-orb'), orb);
    assert.equal(orb?.getAttribute('state'), 'thinking');
    assert.equal(disconnected, 0);
  });

  it('keeps one web component through voice phase updates', async () => {
    customElements.define('voice-orb', class extends dom.window.HTMLElement {});
    await render(<AgentStatusOrb state="idle" size="large" voicePhase="listening" />);
    const orb = container.querySelector('voice-orb');
    assert.equal(orb?.getAttribute('state'), 'listening');
    await render(<AgentStatusOrb state="idle" size="large" voicePhase="speaking" />);
    assert.equal(container.querySelector('voice-orb'), orb);
    assert.equal(orb?.getAttribute('state'), 'speaking');
  });

  it('closes microphone analysis when voice mode ends', async () => {
    customElements.define('voice-orb', class extends dom.window.HTMLElement {});
    const calls: string[] = [];
    class FakeContext {
      createMediaStreamSource() {
        return { connect() {}, disconnect: () => calls.push('source') };
      }
      createAnalyser() {
        return { fftSize: 0, disconnect: () => calls.push('analyser') };
      }
      close() {
        calls.push('context');
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
    const stream = {} as MediaStream;
    await render(
      <AgentStatusOrb state="idle" size="large" voicePhase="listening" micStream={stream} />,
    );
    await render(<AgentStatusOrb state="idle" size="large" voicePhase="off" micStream={stream} />);
    assert.deepEqual(calls, ['source', 'analyser', 'context']);
    await render(
      <AgentStatusOrb state="idle" size="large" voicePhase="listening" micStream={stream} />,
    );
    await render(<span />);
    assert.deepEqual(calls, ['source', 'analyser', 'context', 'source', 'analyser', 'context']);
  });
});
