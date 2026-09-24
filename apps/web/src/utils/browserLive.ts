// The browser tool's live view: the frames the browser router streams and the input the
// view sends back. The router's side, with the message formats, is
// deployment/volition-stack/browser/project-browser-screencast.mjs.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

export type LiveMessage =
  // The view's size in CSS pixels, its pixel ratio, whether it plays video, and whether it
  // holds the page's size ("Größe festhalten": the page keeps its size, the view scales it).
  | { type: 'viewport'; width: number; height: number; dpr: number; video: boolean; hold: boolean }
  | { type: 'follow'; agent: boolean }
  | { type: 'ack' }
  | { type: 'dialog'; accept: boolean; text?: string }
  // Sent when the view is covered (another panel or browser tab in front) or shown again, so
  // the router stops sending it frames and its tier's encoder can stop once no one is left.
  | { type: 'hidden'; hidden: boolean }
  // The video connection's last measured round trip and downlink, and the running total of
  // video bytes this view has received, so the router can put it on the quality tier they
  // afford and knows how much of what it has sent is still unacknowledged.
  | { type: 'stats'; rttMs: number; downlinkKbps: number; receivedBytes: number }
  // This view's decoder fell far enough behind to give up on the gap; answered with a fresh
  // keyframe once the router's rate limit on restarting the tier's encoder allows one.
  | { type: 'requestKeyframe' }
  // Someone works in this view: it takes the page's size from another viewer once their
  // input pauses (whoever steers owns the size; the others scale).
  | { type: 'focus' }
  // Answered with {"type":"pong","t":..} at once, to measure the round trip.
  | { type: 'ping'; t: number }
  | {
      type: 'mouse';
      event: 'move' | 'down' | 'up' | 'click';
      x: number;
      y: number;
      button: MouseButton;
      buttons?: number;
      clickCount?: number;
      modifiers: number;
    }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | KeyMessage
  | { type: 'text'; text: string };

export interface KeyMessage {
  type: 'key';
  event: 'down' | 'up';
  key: string;
  code: string;
  keyCode: number;
  location: number;
  autoRepeat: boolean;
  modifiers: number;
  text?: string;
}

export type MouseButton = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward';

// A JavaScript dialog the page shows, which the browser draws outside the streamed page.
export interface LiveDialog {
  kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultPrompt: string;
}

// An agent's request to the owner to take over (its `browser_handover` tool call, design
// §4, §7: a CAPTCHA, a question only the owner can answer), as the router's `handover` text
// message carries it; since is epoch milliseconds.
export interface LiveHandover {
  reason: string;
  agentName: string;
  since: number;
}

// Who controls the project browser (design §5), as the router's `control` text message
// reports it. `locked` is true once the browser gateway runs: then `by` is the control
// lock's holder ('free' when nobody holds it), with the agent's name and since when (epoch
// ms). Without the gateway `by` is only who last acted on the page ('agent' or 'free').
export interface LiveControlState {
  by: 'agent' | 'owner' | 'free';
  agentName: string | null;
  since: number | null;
  locked: boolean;
}

export const FREE_CONTROL: LiveControlState = {
  by: 'free',
  agentName: null,
  since: null,
  locked: false,
};

// Messages that act on the page: a viewer's input, which the live view holds back while an
// agent controls the browser until the owner took over.
export function isPageInput(message: LiveMessage): boolean {
  return (
    message.type === 'mouse' ||
    message.type === 'wheel' ||
    message.type === 'key' ||
    message.type === 'text'
  );
}

// The DevTools modifier bits.
const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

// The live view's WebSocket next to the control routes (`.../browser/projects/<slug>/api`).
export function screencastUrl(controlBase: string): string {
  return `${controlBase.replace(/^http/, 'ws')}/screencast`;
}

// The kinds of binary message, in their first byte.
export const JPEG_FRAME = 0;
export const VIDEO_INIT = 1;
export const VIDEO_FRAGMENT = 2;
export const JPEG_FRAME_CROPPED = 3;

// A JPEG frame message: the page's viewport in CSS pixels, then the JPEG. A cropped one (a
// page pinned narrower than its window, a phone's view) gives the frame's size and then the
// page's, which fills the frame's left part (crop, the part of the frame to show).
export function readFrame(data: ArrayBuffer): { size: Size; crop: Size | null; jpeg: Blob } {
  const cropped = new Uint8Array(data, 0, 1)[0] === JPEG_FRAME_CROPPED;
  const header = new DataView(data, 1, cropped ? 8 : 4);
  const frame = { width: header.getUint16(0), height: header.getUint16(2) };
  const page = cropped ? { width: header.getUint16(4), height: header.getUint16(6) } : null;
  return {
    size: page ?? frame,
    crop: page ? { width: page.width / frame.width, height: page.height / frame.height } : null,
    jpeg: new Blob([new Uint8Array(data, cropped ? 9 : 5)], { type: 'image/jpeg' }),
  };
}

// A page this many CSS pixels larger or smaller than the view is shown one to one, cut off or
// with a thin band at the edge, rather than scaled by a fraction of a percent, which would blur
// it: the video needs even sizes, so a page at ratio 1 is a pixel larger than an odd view.
const EXACT_SLACK = 2;

// Where a frame is drawn in the view, in CSS pixels from the view's top left corner. natural
// is the page's size in CSS pixels at 100 % zoom, which the frame shows. A page the view's size
// (give or take EXACT_SLACK) is drawn one to one from the corner; any other — while the panel
// is dragged and until the page has the new size, or while another view or a fixed size sets
// it — is scaled to fit and centred, as object-fit: contain does. Whole pixels, so a frame
// drawn one to one stays sharp.
export function frameRect(box: Size, natural: Size): Rect {
  const near =
    Math.abs(box.width - natural.width) <= EXACT_SLACK &&
    Math.abs(box.height - natural.height) <= EXACT_SLACK;
  if (near) return { left: 0, top: 0, width: natural.width, height: natural.height };
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);
  return {
    left: Math.round((box.width - width) / 2),
    top: Math.round((box.height - height) / 2),
    width,
    height,
  };
}

// The page point, in the CSS pixels input is given in (page: the shown frame's size at the
// page's zoom), under a point of the view given relative to its top left corner, for a frame
// drawn at rect. A point beside the drawn frame, on a band, is moved onto its edge.
export function pagePoint(point: Point, rect: Rect, page: Size): Point {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return {
    x: clamp(((point.x - rect.left) / rect.width) * page.width, page.width),
    y: clamp(((point.y - rect.top) / rect.height) * page.height, page.height),
  };
}

interface ModifierKeys {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

// The project browser runs on Linux, where the shortcuts a Mac takes with Command use
// Control, so Command is sent as Control from a Mac.
export function modifiers(event: ModifierKeys, mac: boolean): number {
  return (
    (event.altKey ? ALT : 0) |
    (event.ctrlKey || (mac && event.metaKey) ? CONTROL : 0) |
    (event.metaKey && !mac ? META : 0) |
    (event.shiftKey ? SHIFT : 0)
  );
}

const BUTTONS: MouseButton[] = ['left', 'middle', 'right', 'back', 'forward'];

// A pointer event's button (0 left, 1 middle, 2 right, 3 back, 4 forward).
export function mouseButton(button: number): MouseButton {
  return BUTTONS[button] ?? 'none';
}

// The button held during a move, from the pressed-buttons bit set.
export function heldButton(buttons: number): MouseButton {
  if (buttons & 1) return 'left';
  if (buttons & 4) return 'middle';
  if (buttons & 2) return 'right';
  return 'none';
}

export interface Press extends Point {
  time: number;
  button: number;
  count: number;
}

const MULTI_CLICK_MS = 500;
const MULTI_CLICK_DISTANCE = 4;

// Pointer events carry no click count, so a press soon after and near the last one of the
// same button counts as a double or triple click.
export function clickCount(previous: Press | null, next: Omit<Press, 'count'>): number {
  if (
    !previous ||
    previous.button !== next.button ||
    next.time - previous.time > MULTI_CLICK_MS ||
    Math.abs(next.x - previous.x) > MULTI_CLICK_DISTANCE ||
    Math.abs(next.y - previous.y) > MULTI_CLICK_DISTANCE
  ) {
    return 1;
  }
  return Math.min(3, previous.count + 1);
}

// The router takes at most 64 KiB of text per message; 16384 code points stay below that.
const TEXT_CHUNK = 16_384;

// Pasted or composed text as the messages that insert it, split so a long paste fits.
export function textMessages(text: string): LiveMessage[] {
  const characters = [...text];
  const messages: LiveMessage[] = [];
  for (let start = 0; start < characters.length; start += TEXT_CHUNK) {
    messages.push({ type: 'text', text: characters.slice(start, start + TEXT_CHUNK).join('') });
  }
  return messages;
}

// Line and page scrolling (Firefox) as pixels.
export function wheelDelta(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  pageHeight: number,
) {
  const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageHeight : 1;
  return { deltaX: event.deltaX * scale, deltaY: event.deltaY * scale };
}

export interface KeyInput extends ModifierKeys {
  key: string;
  code: string;
  keyCode: number;
  location: number;
  repeat: boolean;
  isComposing: boolean;
  // AltGr, which types characters such as @ on many layouts outside the US.
  altGraph: boolean;
}

// The paste shortcuts, by virtual key code so that they are found on every layout
// (Control+V gives the key м on a Russian one): Control+V and Shift+Insert.
const V_KEY = 86;
const INSERT_KEY = 45;

// Windows virtual key codes, which DevTools wants with every key and which pages and
// Chromium's own shortcuts (Ctrl+A, Ctrl+Z) read. Built from the event's key and code
// rather than taken from its deprecated keyCode, which browsers fill differently (0 for
// some keys of a non-US layout in Firefox, 229 during composition). The tables follow
// Puppeteer's USKeyboardLayout.
const NAMED_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  ' ': 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PrintScreen: 44,
  Insert: 45,
  Delete: 46,
  Meta: 91,
  ContextMenu: 93,
  NumLock: 144,
  ScrollLock: 145,
};
// Keys found by their place on a US keyboard: punctuation and the number pad.
const PHYSICAL_KEY_CODES: Record<string, number> = {
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
  IntlBackslash: 226,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
  NumpadEnter: 13,
};

// A letter or digit keeps the key the person typed on their layout (the Z of a German
// keyboard, where a US one has Y, is undo with Control); a letter of another script is the
// Latin key in its place (Russian м is V), as browsers do it; the rest is its US place.
export function virtualKeyCode(event: Pick<KeyInput, 'key' | 'code' | 'keyCode' | 'location'>) {
  const numpad = event.location === 3;
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(event.key)) return (numpad ? 96 : 48) + Number(event.key);
  const named = NAMED_KEY_CODES[event.key] ?? /^F([1-9]|1[0-9]|2[0-4])$/.exec(event.key)?.[1];
  if (named !== undefined) return typeof named === 'number' ? named : 111 + Number(named);
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) return letter.charCodeAt(0);
  const digit = /^(Digit|Numpad)([0-9])$/.exec(event.code);
  if (digit) return (digit[1] === 'Numpad' ? 96 : 48) + Number(digit[2]);
  return PHYSICAL_KEY_CODES[event.code] ?? (event.keyCode === 229 ? 0 : event.keyCode);
}

// The message for a key event, or null for one the page must not get as a key: a key of
// an IME composition, whose result is sent as text when it ends, and a paste shortcut,
// whose clipboard text the paste event sends.
export function keyMessage(event: KeyInput, type: 'down' | 'up', mac: boolean): KeyMessage | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Dead' ||
    event.key === 'Unidentified'
  ) {
    return null;
  }
  const printable = [...event.key].length === 1;
  // Option on a Mac and AltGr elsewhere type a character rather than a shortcut.
  const typesCharacter =
    printable && (event.altGraph || (mac && event.altKey && !event.metaKey && !event.ctrlKey));
  const pressed = typesCharacter ? (event.shiftKey ? SHIFT : 0) : modifiers(event, mac);
  const keyCode = virtualKeyCode(event);
  const paste =
    (keyCode === V_KEY && (pressed & ~SHIFT) === CONTROL) ||
    (keyCode === INSERT_KEY && pressed === SHIFT);
  if (paste) return null;
  const command = mac && event.key === 'Meta';
  const key = command ? 'Control' : event.key;
  const typed = key === 'Enter' ? '\r' : printable ? key : undefined;
  const text = type === 'down' && (pressed & (CONTROL | META)) === 0 ? typed : undefined;
  return {
    type: 'key',
    event: type,
    key,
    code: command ? event.code.replace('Meta', 'Control') : event.code,
    keyCode: command ? 17 : keyCode,
    location: event.location,
    autoRepeat: event.repeat,
    modifiers: pressed,
    ...(text && { text }),
  };
}
