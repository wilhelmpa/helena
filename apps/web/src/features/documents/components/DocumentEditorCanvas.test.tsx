import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import { SessionProvider } from '@/lib/auth-client';
import documents from '../../../../messages/en/documents.json';
import common from '../../../../messages/en/common.json';
import type { NoteDraft } from '../utils/noteDraft';
import { requestBodyFocus, takeBodyFocus } from '../utils/bodyFocus';

let DocumentEditorCanvas: typeof import('./DocumentEditorCanvas').default;
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;
let editor: Editor | null;
let loadedBody: string;
let editedBody: string;
let lossless: boolean | null;

const path = 'Projects/RES/Docs/Trade.md';
const body =
  '| Symbol | Trade |\n| --- | --- |\n| SPY | [[TRADE-1|SPY]] |\n\nFirst line\nSecond line\n';
const loaded: NoteDraft['loaded'] = { body, frontmatter: { type: 'trade' }, revision: 0 };
const globals = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLAnchorElement',
  'CustomEvent',
  'NodeFilter',
  'HTMLInputElement',
  'HTMLButtonElement',
  'PointerEvent',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
  'ResizeObserver',
];

function Probe({ note = loaded }: { note?: NoteDraft['loaded'] }) {
  const [instance, setInstance] = useState<Editor | null>(null);
  const [safe, setSafe] = useState(false);
  return (
    <DocumentEditorCanvas
      path={path}
      updatedAt="2026-09-27T12:00:00Z"
      truncated={false}
      loaded={note}
      editor={instance}
      editable={safe}
      canRename
      focusTitle={false}
      onEditorReady={(value) => {
        editor = value;
        setInstance(value);
      }}
      onLoaded={(value) => {
        loadedBody = value;
      }}
      onLossless={(value) => {
        lossless = value;
        setSafe(value);
      }}
      onEdit={(value) => {
        editedBody = value;
      }}
      onBlur={() => {}}
      onRename={async () => {}}
      onOpenWikilink={() => {}}
    />
  );
}

beforeEach(async () => {
  saved = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://helena.test/',
    pretendToBeVisual: true,
  });
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
      inboxUrl: '',
      connectionsUrl: '',
    },
  };
  for (const name of globals)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'PointerEvent'
          ? dom.window.MouseEvent
          : name === 'ResizeObserver'
            ? class {
                observe() {}
                unobserve() {}
                disconnect() {}
              }
            : name === 'IS_REACT_ACT_ENVIRONMENT'
              ? true
              : name === 'requestAnimationFrame'
                ? (callback: FrameRequestCallback) => setTimeout(callback, 0)
                : name === 'cancelAnimationFrame'
                  ? clearTimeout
                  : (dom.window as unknown as Record<string, unknown>)[name],
    });
  dom.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  });
  dom.window.Range.prototype.getClientRects = () =>
    ({
      length: 1,
      item: () => new dom.window.DOMRect(),
      0: new dom.window.DOMRect(),
    }) as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  ({ default: DocumentEditorCanvas } = await import('./DocumentEditorCanvas'));
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  editor = null;
  loadedBody = '';
  editedBody = '';
  lossless = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 10));
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

it('round trips table aliases and soft breaks through the Docs canvas', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requestBodyFocus();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ documents, common }}>
          <SessionProvider>
            <RelativeTimeProvider>
              <Probe />
            </RelativeTimeProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  assert.equal(lossless, true);
  assert.equal(loadedBody, body);
  const link = document.querySelector('[data-wikilink]');
  assert.equal(link?.textContent, 'SPY');
  assert.ok(link?.classList.contains('wikilink-chip'));
  assert.equal(editor?.isEditable, true);
  assert.equal(takeBodyFocus(), false);
  await act(async () => {
    editor!.commands.insertContentAt(editor!.state.doc.content.size, '<p>New paragraph</p>');
  });
  assert.ok(editedBody.includes('| SPY | [[TRADE-1|SPY]] |'));
  assert.ok(editedBody.includes('First line\nSecond line'));
  assert.ok(editedBody.endsWith('\n'));
});

it('keeps a lossy document read-only and retains the original source for saving', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const source = '# Trade\n\n<!-- original comment -->\n\nBody\n';
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ documents, common }}>
          <SessionProvider>
            <RelativeTimeProvider>
              <Probe note={{ ...loaded, body: source }} />
            </RelativeTimeProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  assert.equal(lossless, false);
  assert.equal(loadedBody, source);
  assert.equal(editor?.isEditable, false);
  assert.equal(editedBody, '');
});
