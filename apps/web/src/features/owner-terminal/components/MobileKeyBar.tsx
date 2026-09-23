'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

// One physical key or literal character. wetty's xterm.js instance reads
// keydown/keyup off its own hidden textarea with a plain addEventListener, which
// fires for a dispatched (non-"trusted") event exactly like a real one -- the
// isTrusted flag only gates a handful of browser-native default actions (like a
// real Enter submitting a <form>), not JS listeners. That, plus the iframe being
// same-origin (both under the Plan host), is what makes sendKey below work at
// all: a cross-origin iframe's contentDocument would not be reachable.
interface KeySpec {
  // A word key shows its translated name (design: "Strg" in German, not "Ctrl").
  // An arrow or symbol key shows the literal character instead -- universal, and
  // what the design itself lists ("|, ~, /, -"), so `label` skips translation.
  labelKey?: string;
  label?: string;
  key: string;
  code: string;
}

const KEYS: KeySpec[] = [
  { labelKey: 'esc', key: 'Escape', code: 'Escape' },
  { labelKey: 'tab', key: 'Tab', code: 'Tab' },
  { labelKey: 'ctrl', key: 'Control', code: 'ControlLeft' },
  { labelKey: 'alt', key: 'Alt', code: 'AltLeft' },
  { label: '←', key: 'ArrowLeft', code: 'ArrowLeft' },
  { label: '↑', key: 'ArrowUp', code: 'ArrowUp' },
  { label: '↓', key: 'ArrowDown', code: 'ArrowDown' },
  { label: '→', key: 'ArrowRight', code: 'ArrowRight' },
  { label: '|', key: '|', code: 'Backslash' },
  { label: '~', key: '~', code: 'Backquote' },
  { label: '/', key: '/', code: 'Slash' },
  { label: '-', key: '-', code: 'Minus' },
];

function dispatchKey(target: Document, spec: KeySpec) {
  const element = (target.activeElement as HTMLElement | null) ?? target.body;
  for (const type of ['keydown', 'keyup'] as const) {
    element.dispatchEvent(
      new KeyboardEvent(type, { key: spec.key, code: spec.code, bubbles: true, cancelable: true }),
    );
  }
}

export default function MobileKeyBar({ frame }: { frame: HTMLIFrameElement | null }) {
  const t = useTranslations('ownerTerminal.keys');

  function press(spec: KeySpec) {
    const doc = frame?.contentDocument;
    if (doc) dispatchKey(doc, spec);
    frame?.contentWindow?.focus();
  }

  async function paste() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    try {
      const text = await navigator.clipboard.readText();
      const element = (doc.activeElement as HTMLElement | null) ?? doc.body;
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: undefined }));
      // xterm listens for the real paste event's clipboardData, which a synthetic
      // ClipboardEvent cannot carry in every browser -- falling back to typing the
      // text as individual input is what actually reaches the shell everywhere.
      for (const char of text) {
        element.dispatchEvent(
          new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }),
        );
      }
    } catch {
      // Clipboard read needs a permission the mobile browser may refuse; nothing
      // to recover here, the owner can still select-and-paste inside the frame.
    }
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t bg-sidebar px-1">
      {KEYS.map((spec) => (
        <Button
          key={spec.labelKey ?? spec.label}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 font-mono text-xs"
          onClick={() => press(spec)}
        >
          {spec.labelKey ? t(spec.labelKey) : spec.label}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={() => void paste()}
      >
        {t('paste')}
      </Button>
    </div>
  );
}
