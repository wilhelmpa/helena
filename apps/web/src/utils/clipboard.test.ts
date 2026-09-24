import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

// A page on plain http: no navigator.clipboard, no ClipboardItem, and a document whose
// execCommand('copy') records what the hidden textarea held.
const replaced = ['window', 'document', 'navigator'] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let copied: string[];

beforeEach(() => {
  saved = new Map(
    replaced.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://kingston-server.local/' });
  copied = [];
  dom.window.document.execCommand = ((command: string) => {
    if (command !== 'copy') return false;
    const area = dom.window.document.querySelector('textarea');
    copied.push(area?.value ?? '');
    return true;
  }) as Document['execCommand'];
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
  });
});

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('installClipboardFallback', () => {
  it('lets a library copy text through the standard API on plain http', async () => {
    // A fresh module per test: the stand-in is installed once per page.
    const { installClipboardFallback } = await import(`./clipboard?case=${Math.random()}`);
    assert.equal((navigator as Navigator & { clipboard?: unknown }).clipboard, undefined);

    installClipboardFallback();
    await navigator.clipboard.writeText('const a = 1;');

    const Item = (window as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem;
    await navigator.clipboard.write([
      new Item({
        'text/plain': new Blob(['| a | b |'], { type: 'text/plain' }),
        'text/html': new Blob(['<table></table>'], { type: 'text/html' }),
      }),
    ]);

    assert.deepEqual(copied, ['const a = 1;', '| a | b |']);
    // The hidden textarea is gone again.
    assert.equal(document.querySelectorAll('textarea').length, 0);
  });

  it('refuses what is not text, the way a browser refuses a type it cannot write', async () => {
    const { installClipboardFallback } = await import(`./clipboard?case=${Math.random()}`);
    installClipboardFallback();
    const Item = (window as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem;
    await assert.rejects(
      navigator.clipboard.write([new Item({ 'image/png': new Blob([]) })]),
      /Only text/,
    );
  });

  it('leaves a secure page alone', async () => {
    const { installClipboardFallback } = await import(`./clipboard?case=${Math.random()}`);
    const real = { writeText: async () => {} };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: real });
    installClipboardFallback();
    assert.equal(navigator.clipboard, real);
  });
});
