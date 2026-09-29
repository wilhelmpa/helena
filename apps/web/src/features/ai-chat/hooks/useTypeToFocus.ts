'use client';

import { useEffect, type RefObject } from 'react';
import { isTypingTarget } from '@/utils/hotkeys';

// Surfaces that own the keyboard while they are open: a key pressed there is theirs.
const OWNED = '[role="dialog"], [role="menu"], [role="listbox"], .ds-side-panel, .ds-modal-layer';

// A plain key that would type a character: one printable key, no ⌘/Ctrl/Alt.
export function typesCharacter(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat
  );
}

// The big chat (Start, /chat, a project's chat page): whatever is typed while the focus is
// nowhere in particular — after clicking send, after the first answer replaced the send
// button, on a click into the empty page — goes into the composer. Without this the
// letters reached the app's one-key shortcuts instead: "b" opened „Neues Projekt“, "l"
// switched the layout and laid the tool panel over the chat (owner, 29.09., O64).
//
// Runs in the capture phase on window, so it sees the key before the shortcut layer
// (hooks/useKeyboardShortcuts, a bubbling window listener), moves the focus into the
// field and stops the key there; the browser then types the character into the newly
// focused field, as it does for type-to-search.
export function useTypeToFocus(fieldRef: RefObject<HTMLTextAreaElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !typesCharacter(event)) return;
      const field = fieldRef.current;
      if (!field || field.disabled || !field.isConnected) return;
      const target = event.target;
      if (target === field || isTypingTarget(target)) return;
      if (target instanceof Element && target.closest(OWNED)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], .ds-modal-layer')) return;
      // A button or link keeps Space (its click); letters are typed.
      if (
        event.key === ' ' &&
        target instanceof Element &&
        target.closest('button, a, [role="button"]')
      )
        return;
      field.focus();
      event.stopPropagation();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, fieldRef]);
}
