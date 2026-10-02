import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import chatWorkspace from '../../../messages/de/chatWorkspace.json';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLFormElement',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'FocusEvent',
  'MouseEvent',
  'Node',
  'Element',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;

beforeEach(async () => {
  saved = new Map(
    replaced.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://helena.test/' });
  dom.window.__ITSAPLAN_ENV__ = {
    apiUrl: 'http://localhost:3000',
    privacyUrl: '',
    termsUrl: '',
    workspace: {
      homeChatProjectKey: '',
      terminalUrl: '',
      codeUrl: '',
      projectWorkspacePaths: {},
      homeWorkspacePath: '',
      browserUrl: '',
    },
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
    DocumentFragment: { configurable: true, value: dom.window.DocumentFragment },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
    FocusEvent: { configurable: true, value: dom.window.FocusEvent },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    Node: { configurable: true, value: dom.window.Node },
    Element: { configurable: true, value: dom.window.Element },
    MutationObserver: { configurable: true, value: dom.window.MutationObserver },
    getComputedStyle: { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) },
    requestAnimationFrame: {
      configurable: true,
      // A frame that comes after the test's page is gone does nothing.
      value: (callback: FrameRequestCallback) =>
        setTimeout(() => {
          if (typeof window !== 'undefined') callback(0);
        }, 0),
    },
    cancelAnimationFrame: { configurable: true, value: (id: number) => clearTimeout(id) },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  // What Radix's select needs of the browser and jsdom lacks.
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => undefined;
  proto.scrollIntoView = () => undefined;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

const model = (id: string, name: string): AiChatModel =>
  ({ id, name, thinkingLevels: [], local: true }) as unknown as AiChatModel;
const models = [
  model('helena-halogen/halogen-qwen3.8-flash-next', 'Flash'),
  model('helena-volition-npu/gemma4-it:e2b', 'gemma4-it:e2b'),
];

async function render(props: {
  runtime: 'hermes' | 'claude' | 'helena';
  model: string | null;
  onChange?: (runtime: string, model: string | null, reasoning: string | null) => void;
}) {
  // Radix reads the browser at import: load the picker once the page globals are in place.
  const { default: RuntimePicker } = await import('./RuntimePicker');
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="de"
        messages={{ chatWorkspace }}
        timeZone="Europe/Berlin"
        onError={() => undefined}
      >
        <RuntimePicker
          runtime={props.runtime}
          model={props.model}
          reasoning={null}
          models={models}
          onChange={props.onChange ?? (() => undefined)}
        />
      </NextIntlClientProvider>,
    );
  });
}

// Opens the select with this label and returns the texts of its entries.
async function openOptions(label: string): Promise<string[]> {
  const trigger = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  });
  return [...document.querySelectorAll('[role="option"], [data-slot="select-label"]')].map(
    (node) => node.textContent ?? '',
  );
}

it('offers the tie to the local standard model first under Lokal', async () => {
  await render({ runtime: 'hermes', model: 'volition-local-default' });
  const entries = await openOptions('Modell');
  assert.ok(entries.some((text) => /Standard \(folgt dem lokalen Hauptmodell\)/.test(text)));
  // The tie counts as chosen: no "not available" line for it.
  assert.ok(!entries.some((text) => /Derzeit nicht verfügbar/.test(text)));
});

it('lists the NPU models apart from the GPU ones, by their brand names', async () => {
  await render({ runtime: 'hermes', model: 'helena-halogen/halogen-qwen3.8-flash-next' });
  const entries = await openOptions('Modell');
  assert.ok(entries.includes('GPU'));
  assert.ok(entries.includes('NPU (kleine Modelle)'));
  assert.ok(entries.includes('Gemma 4 E2B'));
  assert.ok(!entries.includes('gemma4-it:e2b'));
});

it('offers no local choices under another runtime', async () => {
  await render({ runtime: 'claude', model: null });
  const entries = await openOptions('Modell');
  // The list did open (the agent default is always there) and has no local entries.
  assert.ok(entries.includes('Agenten-Standard'));
  assert.ok(!entries.some((text) => /Standard \(folgt/.test(text)));
  assert.ok(!entries.includes('NPU (kleine Modelle)'));
});

it('shows the translated local default for Helena without an unavailable warning', async () => {
  await render({ runtime: 'helena', model: 'volition-local-default' });
  const entries = await openOptions('Modell');
  assert.ok(entries.some((text) => text === 'Standard (folgt dem lokalen Hauptmodell)'));
  assert.ok(!entries.some((text) => /Derzeit nicht verfügbar/.test(text)));
});
