import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/utils/hotkeys';

export type MailKey =
  | 'next'
  | 'previous'
  | 'open'
  | 'archive'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'compose'
  | 'search'
  | 'toggleRead'
  | 'move';

const KEYS: Record<string, MailKey> = {
  j: 'next',
  k: 'previous',
  Enter: 'open',
  e: 'archive',
  r: 'reply',
  a: 'replyAll',
  f: 'forward',
  c: 'compose',
  '/': 'search',
  u: 'toggleRead',
  m: 'move',
};

// The inbox keys. They are read in the capture phase and stop there, so while the
// inbox is on screen "c" writes a mail instead of opening the chat. A key typed into
// a field, with a modifier held, or while a dialog is open is left alone.
export function useMailKeyboard(handler: (key: MailKey) => void, enabled = true) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // Enter on a focused button or link is that control's own.
      if (event.key === 'Enter' && (event.target as HTMLElement).closest?.('button, a')) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = KEYS[event.key];
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      latest.current(key);
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled]);
}
