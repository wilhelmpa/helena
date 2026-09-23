// The live view of a project browser. The tab in front is streamed with the DevTools
// screencast to every viewer on the browser's WebSocket, and each viewer's mouse, wheel
// and keyboard input is sent to that tab. The page is shown at the size of the most recent
// viewer's view: the window keeper sizes the real window, so the agent sees the same page.
//
// Server to viewer: a binary message per frame, the width and height of the page's viewport
// in CSS pixels, which mouse input is given in, as two big-endian 16-bit integers followed
// by the JPEG; and {"type":"tab"} when the tab
// in front, its address or its title changes. Viewer to server: JSON text, see
// viewerMessage.
import { listTabs, openBrowser, setLiveViewport } from "./project-browser-control.mjs";

const SCREENCAST = { format: "jpeg", quality: 75, maxWidth: 1920, maxHeight: 1920 };
// Chromium sends the next frame once the last one is acknowledged, so a delayed
// acknowledgement limits the stream to 20 frames a second.
const FRAME_INTERVAL_MS = 50;
// Frames a viewer may have unacknowledged, and bytes the router may hold for it, before it
// misses the frames after them.
const FRAMES_IN_FLIGHT = 2;
const MAX_BUFFERED = 1024 * 1024;
const FOLLOW_INTERVAL_MS = 1_000;
// Chromium keeps a window at least 500 pixels wide.
const MIN_VIEWPORT = { width: 500, height: 200 };
const MAX_VIEWPORT = 4096;
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

// A viewer's message as the DevTools commands it sends to the page, the page size it asks
// for, or its acknowledgement of a frame. A message that is none of these throws.
//
//   {"type":"viewport","width":800,"height":600}          CSS pixels of the view
//   {"type":"ack"}                                        a frame was drawn
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
          width: Math.round(number(message.width, MIN_VIEWPORT.width, MAX_VIEWPORT)),
          height: Math.round(number(message.height, MIN_VIEWPORT.height, MAX_VIEWPORT)),
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

// The binary message of one screencast frame. The frame's metadata gives the viewport in
// window pixels, which page zoom makes larger than the CSS pixels input is given in.
export function frameMessage(jpeg, metadata, zoom) {
  const cssPixels = (value) => Math.min(0xffff, Math.max(0, Math.round((value || 0) / zoom)));
  const header = Buffer.alloc(4);
  header.writeUInt16BE(cssPixels(metadata.deviceWidth), 0);
  header.writeUInt16BE(cssPixels(metadata.deviceHeight), 2);
  return Buffer.concat([header, jpeg]);
}

class Viewer {
  constructor(socket) {
    this.socket = socket;
    this.inFlight = 0;
    this.missed = false;
    this.viewport = null;
  }

  // Sends a frame unless the viewer has not drawn the earlier ones yet; it then gets the
  // newest frame once it catches up.
  offer(frame) {
    if (!frame) return;
    if (this.inFlight >= FRAMES_IN_FLIGHT || this.socket.bufferedAmount > MAX_BUFFERED) {
      this.missed = true;
      return;
    }
    this.inFlight++;
    this.missed = false;
    this.socket.send(frame);
  }

  acknowledge(latest) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.missed) this.offer(latest);
  }
}

class ScreencastStream {
  constructor(port, onEnd) {
    this.port = port;
    this.onEnd = onEnd;
    this.viewers = new Set();
    this.connection = null;
    this.session = null;
    this.targetId = null;
    this.frame = null;
    this.screencastFrame = null;
    this.zoom = 1;
    this.nextAck = 0;
    this.viewport = null;
    this.timer = null;
    this.following = false;
    this.ended = false;
  }

  async start() {
    try {
      this.connection = await openBrowser(this.port);
    } catch {
      return this.end();
    }
    if (this.ended) return this.connection.close();
    this.connection.onEvent = (message) => this.handleEvent(message);
    this.connection.onClose = () => this.end();
    this.connection.send("Target.setDiscoverTargets", { discover: true }).catch(() => {});
    this.timer = setInterval(() => this.follow(), FOLLOW_INTERVAL_MS);
    await this.follow();
  }

  add(socket) {
    const viewer = new Viewer(socket);
    this.viewers.add(viewer);
    viewer.offer(this.frame);
    socket.on("message", (data, binary) => {
      if (!binary) this.receive(viewer, data.toString("utf8"));
    });
    socket.on("close", () => this.remove(viewer));
  }

  remove(viewer) {
    this.viewers.delete(viewer);
    if (this.viewers.size === 0) this.end();
    else this.resize();
  }

  receive(viewer, data) {
    let message;
    try {
      message = viewerMessage(data);
    } catch {
      return;
    }
    if (message.ack) return viewer.acknowledge(this.frame);
    if (message.viewport) {
      viewer.viewport = message.viewport;
      // The set keeps insertion order, so its last viewer with a view is the most recent.
      this.viewers.delete(viewer);
      this.viewers.add(viewer);
      return this.resize();
    }
    if (!this.session) return;
    for (const { method, params } of message.commands) {
      this.connection.send(method, params, this.session).catch(() => {});
    }
  }

  resize() {
    const viewport = [...this.viewers].reverse().find((viewer) => viewer.viewport)?.viewport ?? null;
    if (viewport?.width === this.viewport?.width && viewport?.height === this.viewport?.height) return;
    this.viewport = viewport;
    setLiveViewport(this.port, viewport).catch(() => {});
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const viewer of this.viewers) viewer.socket.send(data);
  }

  // Streams the tab in front, which the person or the agent may have switched, and reads
  // its page zoom.
  async follow() {
    if (this.following || this.ended) return;
    this.following = true;
    try {
      const front = (await listTabs(this.port)).find((tab) => tab.active);
      if (front && front.id !== this.targetId) await this.attach(front.id);
      else if (this.session) await this.readZoom(this.session);
    } catch {
      // The next pass tries again.
    } finally {
      this.following = false;
    }
  }

  async attach(targetId) {
    const previous = this.session;
    this.session = null;
    this.targetId = targetId;
    if (previous) {
      this.connection.send("Target.detachFromTarget", { sessionId: previous }).catch(() => {});
    }
    try {
      const { sessionId } = await this.connection.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await this.readZoom(sessionId);
      this.session = sessionId;
      await this.connection.send("Page.startScreencast", SCREENCAST, sessionId);
    } catch (error) {
      this.targetId = null;
      throw error;
    }
    this.broadcast({ type: "tab" });
  }

  // A zoom change repaints the page before it is read here, so the newest frame is sent
  // again with the new size.
  async readZoom(session) {
    const metrics = await this.connection.send("Page.getLayoutMetrics", {}, session);
    const zoom = metrics.cssVisualViewport?.zoom || 1;
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (this.screencastFrame && session === this.session) this.showFrame(this.screencastFrame);
  }

  handleEvent({ method, params, sessionId }) {
    switch (method) {
      case "Page.screencastFrame":
        if (sessionId === this.session) this.receiveFrame(params, sessionId);
        break;
      case "Page.screencastVisibilityChanged":
        if (!params.visible) void this.follow();
        break;
      case "Target.detachedFromTarget":
        if (params.sessionId === this.session) {
          this.session = null;
          this.targetId = null;
          void this.follow();
        }
        break;
      case "Target.targetInfoChanged":
        if (params.targetInfo?.targetId === this.targetId) this.broadcast({ type: "tab" });
        break;
    }
  }

  showFrame(screencastFrame) {
    this.screencastFrame = screencastFrame;
    this.frame = frameMessage(screencastFrame.jpeg, screencastFrame.metadata, this.zoom);
    for (const viewer of this.viewers) viewer.offer(this.frame);
  }

  receiveFrame({ data, metadata, sessionId: frameId }, session) {
    this.showFrame({ jpeg: Buffer.from(data, "base64"), metadata });
    const delay = Math.max(0, this.nextAck - Date.now());
    this.nextAck = Date.now() + delay + FRAME_INTERVAL_MS;
    setTimeout(() => {
      if (this.session !== session) return;
      this.connection.send("Page.screencastFrameAck", { sessionId: frameId }, session).catch(() => {});
    }, delay);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    this.onEnd();
    for (const viewer of this.viewers) viewer.socket.close(1011, "Browser unavailable");
    this.connection?.close();
    if (this.viewport) setLiveViewport(this.port, null).catch(() => {});
  }
}

const streams = new Map();

// Adds a WebSocket as a viewer of the browser on the given DevTools port. The first
// viewer starts the stream and the last one to leave ends it.
export function joinScreencast(port, socket) {
  let stream = streams.get(port);
  if (!stream) {
    stream = new ScreencastStream(port, () => {
      if (streams.get(port) === stream) streams.delete(port);
    });
    streams.set(port, stream);
    void stream.start();
  }
  stream.add(socket);
}
