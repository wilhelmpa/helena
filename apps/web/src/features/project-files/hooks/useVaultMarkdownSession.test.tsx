import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { act, useLayoutEffect } from 'react';
import type { Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import { useVaultMarkdownSession } from './useVaultMarkdownSession';

type Props = Parameters<typeof useVaultMarkdownSession>[0];
let session: ReturnType<typeof useVaultMarkdownSession>;
let root: Root;
let dom: JSDOM;
let saved: Map<string, PropertyDescriptor | undefined>;
const changes: string[] = [];
function Probe(props: Props) {
  const current = useVaultMarkdownSession(props);
  useLayoutEffect(() => {
    session = current;
  });
  return null;
}
const ready = (markdown: string): Editor =>
  ({ storage: { markdown: { getMarkdown: () => markdown } } }) as Editor;
const props: Props = {
  content: '# Original\n',
  value: '# Original\n',
  vaultPath: 'Projects/RES/Docs/Original.md',
  editable: true,
  onChange: (value) => changes.push(value),
};

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  changes.length = 0;
  await act(async () => root.render(<Probe {...props} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

it('rejects changes before readiness and ignores stale readiness and changes after switching drafts', async () => {
  assert.equal(session.lossless, null);
  session.onChange('# Too early');
  assert.deepEqual(changes, []);
  await act(async () => session.onReady(ready('# Original')));
  assert.equal(session.lossless, true);
  const old = session;
  await act(async () => session.showSource());
  const draft = '# Current draft\n\n<!-- retained -->\n';
  await act(async () => root.render(<Probe {...props} value={draft} />));
  await act(async () => session.showFormatted());
  assert.equal(session.lossless, null);
  await act(async () => old.onReady(ready('# Original')));
  old.onChange('# Late old edit');
  assert.equal(session.lossless, null);
  assert.deepEqual(changes, []);
  await act(async () => session.onReady(ready('# Current draft')));
  assert.equal(session.lossless, false);
  session.onChange('# Destructive edit');
  assert.deepEqual(changes, []);
});

it('falls back to source when the current serializer fails and cannot revive an unmounted path', async () => {
  const old = session;
  await act(async () =>
    root.render(<Probe key="other" {...props} vaultPath="Projects/OTHER/Docs/Original.md" />),
  );
  await act(async () => old.onReady(ready('# Original')));
  old.onChange('# Late write');
  assert.equal(session.lossless, null);
  const broken = {
    storage: {
      markdown: {
        getMarkdown: () => {
          throw new Error('Synthetic parser failure');
        },
      },
    },
  } as unknown as Editor;
  await act(async () => session.onReady(broken));
  assert.equal(session.mode, 'source');
  assert.equal(session.lossless, false);
  assert.deepEqual(changes, []);
});

it('accepts exact image round trips and refuses writes after edit permission is revoked', async () => {
  const image = '# Original\n\n![Chart](Assets/chart.png)\n';
  await act(async () =>
    root.render(<Probe key="image" {...props} content={image} value={image} />),
  );
  assert.ok(session.markdown.includes('/protected-media/'));
  await act(async () => session.onReady(ready(session.markdown.replace(/\n+$/, ''))));
  assert.equal(session.lossless, true);
  const writable = session;
  await act(async () =>
    root.render(<Probe key="image" {...props} content={image} value={image} editable={false} />),
  );
  session.onChange('# Rejected edit');
  writable.onChange('# Rejected stale edit');
  assert.deepEqual(changes, []);
});

it('invalidates a previous path check immediately even without a component remount', async () => {
  await act(async () => session.onReady(ready('# Original')));
  assert.equal(session.lossless, true);
  const old = session;
  await act(async () =>
    root.render(<Probe {...props} vaultPath="Projects/OTHER/Docs/Original.md" />),
  );
  assert.equal(session.lossless, null);
  await act(async () => old.onReady(ready('# Original')));
  session.onChange('# Not ready for this path');
  assert.equal(session.lossless, null);
  assert.deepEqual(changes, []);
});

it('keeps a non-lossless initial document formatted and refuses edits until source is chosen', async () => {
  await act(async () => session.onReady(ready('# Normalized')));
  assert.equal(session.mode, 'formatted');
  assert.equal(session.lossless, false);
  session.onChange('# Destructive normalized write');
  assert.deepEqual(changes, []);
  await act(async () => session.showSource());
  assert.equal(session.mode, 'source');
  assert.deepEqual(changes, []);
});
