'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readClipboardText } from '@/utils/clipboard';
import {
  captureNextCharacter,
  dispatchTerminalKey,
  dispatchTerminalText,
  keyForCharacter,
  NO_MODIFIERS,
  type Modifiers,
  type TerminalKey,
} from '../utils/terminalKeys';

// The keys a phone's keyboard lacks, for the terminal in the WeTTY frame (see
// ../utils/terminalKeys for how they reach xterm.js). A word key shows its translated
// name (design: "Strg" in German, not "Ctrl"); an arrow or symbol key shows the literal
// character instead -- universal, and what the design itself lists ("|, ~, /, -").
//
// Ctrl and Alt are sticky: a tap holds the modifier for the next key, from the bar or from
// the phone's keyboard (Ctrl, then "c" is Ctrl+C), and a second tap lets it go.
type KeyLabel = 'esc' | 'tab';

interface KeySpec extends TerminalKey {
  labelKey?: KeyLabel;
  label?: string;
}

const KEYS_BEFORE_MODIFIERS: KeySpec[] = [
  { labelKey: 'esc', key: 'Escape', code: 'Escape', keyCode: 27 },
  { labelKey: 'tab', key: 'Tab', code: 'Tab', keyCode: 9 },
];

const KEYS_AFTER_MODIFIERS: KeySpec[] = [
  { label: '←', key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  { label: '↑', key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  { label: '↓', key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  { label: '→', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  { label: '|', key: '|', code: 'Backslash', keyCode: 220 },
  { label: '~', key: '~', code: 'Backquote', keyCode: 192 },
  { label: '/', key: '/', code: 'Slash', keyCode: 191 },
  { label: '-', key: '-', code: 'Minus', keyCode: 189 },
];

const KEY_CLASS = 'h-7 shrink-0 px-2 font-mono text-xs';

export default function MobileKeyBar({ frame }: { frame: HTMLIFrameElement | null }) {
  const t = useTranslations('ownerTerminal.keys');
  const [held, setHeld] = useState<Modifiers>(NO_MODIFIERS);
  const holding = held.ctrl || held.alt;

  // A held modifier applies to the next character typed into the terminal as well.
  useEffect(() => {
    const doc = frame?.contentDocument;
    if (!doc || !holding) return;
    return captureNextCharacter(doc, (character) => {
      dispatchTerminalKey(doc, keyForCharacter(character), held);
      setHeld(NO_MODIFIERS);
    });
  }, [frame, held, holding]);

  function press(spec: TerminalKey) {
    const doc = frame?.contentDocument;
    if (doc) dispatchTerminalKey(doc, spec, held);
    setHeld(NO_MODIFIERS);
    frame?.contentWindow?.focus();
  }

  function toggle(modifier: keyof Modifiers) {
    setHeld((current) => ({ ...current, [modifier]: !current[modifier] }));
    frame?.contentWindow?.focus();
  }

  async function paste() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    try {
      dispatchTerminalText(doc, await readClipboardText());
    } catch {
      // readClipboardText needs a secure context or a permission the mobile
      // browser may refuse; nothing to recover here (this LAN instance is plain
      // http -- see @/utils/clipboard), the owner can still select-and-paste
      // inside the frame itself.
    }
  }

  const keyButton = (spec: KeySpec) => (
    <Button
      key={spec.labelKey ?? spec.label}
      type="button"
      variant="ghost"
      size="sm"
      className={KEY_CLASS}
      onClick={() => press(spec)}
    >
      {spec.labelKey ? t(spec.labelKey) : spec.label}
    </Button>
  );

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t bg-sidebar px-1">
      {KEYS_BEFORE_MODIFIERS.map(keyButton)}
      {(['ctrl', 'alt'] as const).map((modifier) => (
        <Button
          key={modifier}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={held[modifier]}
          className={cn(KEY_CLASS, held[modifier] && 'bg-accent text-accent-foreground')}
          onClick={() => toggle(modifier)}
        >
          {t(modifier)}
        </Button>
      ))}
      {KEYS_AFTER_MODIFIERS.map(keyButton)}
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
