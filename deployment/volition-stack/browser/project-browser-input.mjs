// The viewers' messages to the live view, and the order in which their input reaches the page.
// The router's viewer side is in project-browser-screencast.mjs.

const MIN_VIEWPORT = 100;
const MAX_VIEWPORT = 8192;
const MIN_RATIO = 0.5;
const MAX_RATIO = 4;
const MAX_COORDINATE = 100_000;
const MAX_TEXT = 64 * 1024;

const MOUSE_EVENTS = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" };
// Each button with its bit in the pressed-buttons set.
const MOUSE_BUTTONS = { none: 0, left: 1, right: 2, middle: 4, back: 8, forward: 16 };

function invalid() {
  return new Error("Invalid message");
}

function number(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
  return Math.min(max, Math.max(min, value));
}

function integer(value, min, max, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw invalid();
  return value;
}

function text(value, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw invalid();
  return value;
}

function command(method, params) {
  return { commands: [{ method, params }] };
}

function mouseMessage(message, modifiers) {
  const button = message.button ?? "none";
  if (!Object.hasOwn(MOUSE_BUTTONS, button)) throw invalid();
  const pointer = {
    x: number(message.x, 0, MAX_COORDINATE),
    y: number(message.y, 0, MAX_COORDINATE),
    modifiers,
    button,
    buttons: integer(message.buttons, 0, 31, 0),
  };
  const clickCount = integer(message.clickCount, 1, 3, 1);
  if (message.event === "click") {
    const pressed = { ...pointer, buttons: MOUSE_BUTTONS[button], clickCount };
    return {
      commands: [
        { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...pressed } },
        { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...pressed, buttons: 0 } },
      ],
    };
  }
  const type = MOUSE_EVENTS[message.event];
  if (!type) throw invalid();
  return command("Input.dispatchMouseEvent", {
    type,
    ...pointer,
    ...(type !== "mouseMoved" && { clickCount }),
  });
}

function keyMessage(message, modifiers) {
  const location = integer(message.location, 0, 3, 0);
  const key = {
    key: text(message.key, 64),
    code: message.code === undefined || message.code === "" ? "" : text(message.code, 64),
    windowsVirtualKeyCode: integer(message.keyCode, 0, 255, 0),
    modifiers,
    location,
    isKeypad: location === 3,
    autoRepeat: message.autoRepeat === true,
  };
  const typed = message.text === undefined ? undefined : text(message.text, 16);
  switch (message.event) {
    // A key that types sends keyDown with its text, which also raises keypress and input.
    case "down":
      return command("Input.dispatchKeyEvent", {
        type: typed ? "keyDown" : "rawKeyDown",
        ...key,
        ...(typed && { text: typed }),
      });
    case "up":
      return command("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    case "char":
      if (!typed) throw invalid();
      return command("Input.dispatchKeyEvent", { type: "char", ...key, text: typed });
    default:
      throw invalid();
  }
}

// A viewer's message as the DevTools commands it sends to the page, the view it shows the page
// in, its acknowledgement of a frame, or its answer to a dialog. A message that is none of
// these throws.
//
//   {"type":"viewport","width":800,"height":600,"dpr":2,"video":true}
//                                                         CSS pixels and pixel ratio of the view,
//                                                         and whether it plays H.264 video
//   {"type":"ack"}                                        a JPEG frame was drawn
//   {"type":"dialog","accept":true,"text":"answer"}       closes a JavaScript dialog
//   {"type":"follow","agent":true}                        shows the agent's tab
//   {"type":"hidden","hidden":true}                       the view is covered, or shown again
//   {"type":"stats","rttMs":40,"downlinkKbps":3200}       the video connection just measured
//   {"type":"ping","t":123.4}                              answered with {"type":"pong","t":..}
//   {"type":"mouse","event":"move|down|up|click","x":..,"y":..,"button":"left",
//    "buttons":1,"clickCount":1,"modifiers":0}            x and y in page CSS pixels
//   {"type":"wheel","x":..,"y":..,"deltaX":0,"deltaY":120,"modifiers":0}
//   {"type":"key","event":"down|up|char","key":"a","code":"KeyA","keyCode":65,
//    "text":"a","location":0,"autoRepeat":false,"modifiers":0}
//   {"type":"text","text":"pasted text"}
//
// modifiers is the DevTools bit set: Alt 1, Control 2, Meta 4, Shift 8.
export function viewerMessage(data) {
  let message;
  try {
    message = JSON.parse(data);
  } catch {
    throw invalid();
  }
  if (!message || typeof message !== "object") throw invalid();
  const modifiers = integer(message.modifiers, 0, 15, 0);
  switch (message.type) {
    case "ack":
      return { ack: true };
    case "viewport":
      return {
        viewport: {
          width: Math.round(number(message.width, MIN_VIEWPORT, MAX_VIEWPORT)),
          height: Math.round(number(message.height, MIN_VIEWPORT, MAX_VIEWPORT)),
          dpr: Math.round(number(message.dpr ?? 1, MIN_RATIO, MAX_RATIO) * 1000) / 1000,
          video: message.video === true,
        },
      };
    case "follow":
      if (typeof message.agent !== "boolean") throw invalid();
      return { followAgent: message.agent };
    case "hidden":
      if (typeof message.hidden !== "boolean") throw invalid();
      return { hidden: message.hidden };
    case "stats":
      return {
        stats: {
          rttMs: number(message.rttMs ?? 0, 0, 60_000),
          downlinkKbps: number(message.downlinkKbps ?? 0, 0, 10_000_000),
        },
      };
    case "ping":
      return { ping: number(message.t, -1e15, 1e15) };
    case "dialog":
      if (typeof message.accept !== "boolean") throw invalid();
      return {
        dialog: {
          accept: message.accept,
          ...(message.text !== undefined && { promptText: String(message.text).slice(0, MAX_TEXT) }),
        },
      };
    case "mouse":
      return mouseMessage(message, modifiers);
    case "wheel":
      return command("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: number(message.x, 0, MAX_COORDINATE),
        y: number(message.y, 0, MAX_COORDINATE),
        deltaX: number(message.deltaX ?? 0, -MAX_COORDINATE, MAX_COORDINATE),
        deltaY: number(message.deltaY ?? 0, -MAX_COORDINATE, MAX_COORDINATE),
        modifiers,
      });
    case "key":
      return keyMessage(message, modifiers);
    case "text":
      return command("Input.insertText", { text: text(message.text, MAX_TEXT) });
    default:
      throw invalid();
  }
}

// Pointer moves and wheel turns merge while the page has not taken the previous one: a move
// is replaced by the newer one, and wheel turns add up.
function mergeKind(method, params) {
  if (method !== "Input.dispatchMouseEvent") return null;
  if (params.type === "mouseMoved") return "move";
  if (params.type === "mouseWheel") return "wheel";
  return null;
}

function merge(kind, earlier, later) {
  if (kind !== "wheel" || !earlier) return later;
  return {
    ...later,
    deltaX: earlier.deltaX + later.deltaX,
    deltaY: earlier.deltaY + later.deltaY,
  };
}

// Sends one viewer's input to the page in the order it came. A fast mouse or wheel does not
// queue up behind a busy page: while a move or wheel command is unanswered, the next ones of
// its kind are merged, and a click or key sends the merged one first.
export class InputSender {
  constructor(send) {
    this.send = send;
    this.busy = new Set();
    this.pending = new Map();
  }

  dispatch({ method, params }) {
    const kind = mergeKind(method, params);
    if (!kind) {
      this.flush();
      return void this.send(method, params);
    }
    if (this.busy.has(kind)) {
      this.pending.set(kind, merge(kind, this.pending.get(kind), params));
      return;
    }
    this.busy.add(kind);
    this.send(method, params).finally(() => {
      this.busy.delete(kind);
      const next = this.pending.get(kind);
      this.pending.delete(kind);
      if (next) this.dispatch({ method, params: next });
    });
  }

  flush() {
    for (const params of this.pending.values()) void this.send("Input.dispatchMouseEvent", params);
    this.pending.clear();
  }
}
