// Keys for the terminal inside the WeTTY frame, sent from the mobile key bar.
//
// xterm.js reads keydown off its hidden textarea with a plain listener, which fires for a
// dispatched (untrusted) event like for a real one, and the frame is same-origin, so its
// document is reachable. xterm decides what a key sends by the legacy `keyCode` (Escape is
// 27, Ctrl+C is keyCode 67 with ctrlKey), which a KeyboardEvent built from `key` and `code`
// leaves at 0, so every dispatched key carries its keyCode as well.

export interface TerminalKey {
  key: string;
  code: string;
  keyCode: number;
}

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false };

// US-layout keyCodes of the punctuation keys, as xterm.js maps them back.
const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {};
for (const [keys, code, keyCode] of [
  [';:', 'Semicolon', 186],
  ['=+', 'Equal', 187],
  [',<', 'Comma', 188],
  ['-_', 'Minus', 189],
  ['.>', 'Period', 190],
  ['/?', 'Slash', 191],
  ['`~', 'Backquote', 192],
  ['[{', 'BracketLeft', 219],
  ['\\|', 'Backslash', 220],
  [']}', 'BracketRight', 221],
  ['\'"', 'Quote', 222],
] as const) {
  for (const key of keys) PUNCTUATION[key] = { code, keyCode };
}

// The key a typed character comes from.
export function keyForCharacter(character: string): TerminalKey {
  const upper = character.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    return { key: character, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(character)) {
    return { key: character, code: `Digit${character}`, keyCode: character.charCodeAt(0) };
  }
  if (character === ' ') return { key: ' ', code: 'Space', keyCode: 32 };
  const punctuation = PUNCTUATION[character];
  return punctuation
    ? { key: character, ...punctuation }
    : { key: character, code: '', keyCode: 0 };
}

// Events this module dispatched, which captureNextCharacter lets through.
const dispatched = new WeakSet<Event>();

function focusedElement(target: Document): HTMLElement {
  return (target.activeElement as HTMLElement | null) ?? target.body;
}

// One key press (keydown and keyup) with the given modifiers held.
export function dispatchTerminalKey(target: Document, key: TerminalKey, modifiers: Modifiers) {
  const element = focusedElement(target);
  // The frame's own KeyboardEvent, so the event belongs to the frame's realm.
  const KeyboardEventOfFrame = target.defaultView?.KeyboardEvent ?? KeyboardEvent;
  for (const type of ['keydown', 'keyup'] as const) {
    const event = new KeyboardEventOfFrame(type, {
      key: key.key,
      code: key.code,
      ctrlKey: modifiers.ctrl,
      altKey: modifiers.alt,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { value: key.keyCode });
    Object.defineProperty(event, 'which', { value: key.keyCode });
    dispatched.add(event);
    element.dispatchEvent(event);
  }
}

// Types text the way xterm.js takes typed text: an insertText input event on its textarea.
// Line breaks become carriage returns, as xterm's own paste sends them.
export function dispatchTerminalText(target: Document, text: string) {
  const InputEventOfFrame = target.defaultView?.InputEvent ?? InputEvent;
  const event = new InputEventOfFrame('input', {
    data: text.replace(/\r?\n/g, '\r'),
    inputType: 'insertText',
    bubbles: true,
  });
  dispatched.add(event);
  focusedElement(target).dispatchEvent(event);
}

// While Ctrl or Alt is latched on the bar, the next character typed into the terminal is
// taken over and handed to onCharacter, which sends it with the modifier. A hardware
// keyboard's keydown carries the character; a phone's soft keyboard often only says
// "Unidentified" there and delivers the character as beforeinput. Returns the cleanup.
export function captureNextCharacter(target: Document, onCharacter: (character: string) => void) {
  const take = (event: Event, character: string) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    onCharacter(character);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (dispatched.has(event) || event.ctrlKey || event.altKey || event.metaKey) return;
    if ([...event.key].length === 1) take(event, event.key);
  };
  const onBeforeInput = (event: InputEvent) => {
    if (dispatched.has(event) || event.inputType !== 'insertText' || !event.data) return;
    const [first, ...rest] = [...event.data];
    take(event, first!);
    // A keyboard that inserts several characters at once (autocorrect) keeps the rest.
    if (rest.length > 0) dispatchTerminalText(target, rest.join(''));
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('beforeinput', onBeforeInput, true);
  };
}
