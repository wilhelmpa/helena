import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { attachTerminalTheme, terminalThemes } from '@/utils/terminalTheme';

test('Wetty and code-server use the same sixteen ANSI colors', () => {
  for (const mode of ['dark', 'light'] as const) {
    const file = new URL(
      `../../../../../../deployment/volition-stack/native/tools-style/code-theme/themes/${mode}.json`,
      import.meta.url,
    );
    const codeColors = JSON.parse(readFileSync(file, 'utf8')).colors as Record<string, string>;
    for (const [name, color] of Object.entries(terminalThemes[mode])) {
      if (['background', 'foreground', 'cursor', 'selectionBackground'].includes(name)) continue;
      assert.equal(codeColors[`terminal.ansi${name[0]!.toUpperCase()}${name.slice(1)}`], color);
    }
  }
});

test('Wetty gets the Helena ANSI palette and terminal dimensions in both modes', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const parent = new JSDOM('<!doctype html><iframe></iframe>');
  const frame = parent.window.document.querySelector('iframe')!;
  const previousWindow = globalThis.window;
  Object.defineProperty(frame, 'contentWindow', { value: dom.window });
  globalThis.window = parent.window as unknown as Window & typeof globalThis;
  const term = {
    options: {} as Record<string, unknown>,
    resizeTermCalls: 0,
    resizeTerm() {
      this.resizeTermCalls++;
    },
  };
  (dom.window as unknown as { wetty_term: typeof term }).wetty_term = term;
  try {
    const detachDark = attachTerminalTheme(frame, 'dark');
    assert.deepEqual(term.options.theme, terminalThemes.dark);
    assert.equal(term.options.fontSize, 13);
    assert.equal(term.options.lineHeight, 1.25);
    assert.equal(term.options.fontFamily, 'Helena JetBrains Mono, monospace');
    assert.match(dom.window.document.head.innerHTML, /padding:12px/);
    assert.equal(term.resizeTermCalls, 1);
    detachDark();

    const detachLight = attachTerminalTheme(frame, 'light');
    assert.deepEqual(term.options.theme, terminalThemes.light);
    assert.match(dom.window.document.head.innerHTML, /background:#faf9f7/);
    assert.equal(term.resizeTermCalls, 2);
    detachLight();
  } finally {
    globalThis.window = previousWindow;
    dom.window.close();
    parent.window.close();
  }
});
