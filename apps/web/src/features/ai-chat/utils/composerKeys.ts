// What a key pressed in the composer's field does, decided apart from the DOM so every
// combination can be tested:
// - with the `/` menu open: ↑/↓ move through it, Enter or Tab picks, Escape closes it
// - Escape while an answer is being written stops it (as in claude.ai)
// - ⌘/Ctrl+Enter breaks the line, like Shift+Enter (which the field does itself)
// - ↑ in an empty field edits the last own message (the claude.ai/ChatGPT convention)
// - anything else is left to the field: Enter sends (PromptInputTextarea submits the form)
export type ComposerKeyAction =
  | 'menu-next'
  | 'menu-previous'
  | 'menu-pick'
  | 'menu-close'
  | 'stop'
  | 'newline'
  | 'edit-last'
  | 'default';

export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  // An IME composition is running (Japanese, Chinese …): its Enter confirms a word.
  isComposing: boolean;
}

export interface ComposerKeyState {
  menuOpen: boolean;
  busy: boolean;
  // The field holds no text.
  empty: boolean;
  // There is a message of the member's own to edit.
  canEditLast: boolean;
}

export function composerKeyAction(key: ComposerKey, state: ComposerKeyState): ComposerKeyAction {
  if (key.isComposing) return 'default';
  const modified = key.shiftKey || key.metaKey || key.ctrlKey || key.altKey;
  if (state.menuOpen) {
    if (key.key === 'ArrowDown' && !modified) return 'menu-next';
    if (key.key === 'ArrowUp' && !modified) return 'menu-previous';
    if ((key.key === 'Enter' || key.key === 'Tab') && !modified) return 'menu-pick';
    if (key.key === 'Escape') return 'menu-close';
  }
  if (key.key === 'Escape' && state.busy) return 'stop';
  if (key.key === 'Enter' && (key.metaKey || key.ctrlKey)) return 'newline';
  if (key.key === 'ArrowUp' && !modified && state.empty && !state.busy && state.canEditLast) {
    return 'edit-last';
  }
  return 'default';
}
