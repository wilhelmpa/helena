import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import ArtifactPreviewFrame from './ArtifactPreviewFrame';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ chatWorkspace }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  const element = document.querySelector('#root');
  assert.ok(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

// Security regression test: the artifact preview must never be able to read the
// app's own cookies/storage or call its API. That guarantee lives entirely in the
// sandbox attribute — a component that forgets it, or a caller that widens it,
// would otherwise be silent.
describe('ArtifactPreviewFrame', () => {
  it('sandboxes scripts without granting the same origin as the app', () => {
    render(<ArtifactPreviewFrame artifact={{ language: 'html', code: '<h1>Hi</h1>' }} />);
    const frame = document.querySelector('iframe');
    assert.ok(frame);
    const sandbox = (frame!.getAttribute('sandbox') ?? '').split(' ');
    assert.ok(sandbox.includes('allow-scripts'));
    assert.ok(!sandbox.includes('allow-same-origin'));
    assert.ok(!frame!.hasAttribute('src'));
  });

  it("carries the artifact's own content as srcdoc, not a script the app injects", () => {
    render(<ArtifactPreviewFrame artifact={{ language: 'html', code: '<p>hello</p>' }} />);
    const frame = document.querySelector('iframe');
    const srcdoc = frame!.getAttribute('srcdoc') ?? '';
    assert.match(srcdoc, /<p>hello<\/p>/);
    assert.match(srcdoc, /Content-Security-Policy/);
  });
});
