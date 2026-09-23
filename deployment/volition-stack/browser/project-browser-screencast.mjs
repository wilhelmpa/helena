// The live view of a project browser: the tab the agent works in, or else the tab in front,
// streamed to every viewer on the browser's WebSocket, with each viewer's mouse, wheel and
// keyboard input sent to that tab.
//
// The stream is H.264 video grabbed from the project's X display (project-browser-video.mjs)
// when every viewer can play it, and the DevTools screencast as JPEG frames otherwise or when
// the encoder fails. The page is shown at the CSS size of the most recent viewer's view, and
// on a high-density screen at pixel ratio 2: the window keeper sizes the real window to the
// view in window pixels and draws its tabs at that ratio. The agent works on that same page.
// While the agent acts, the page keeps its CSS size, so the layout does not move between the
// agent's look at the page and its next action; a JPEG stream then also drops to ratio 1 and
// 20 frames a second, because a sharp JPEG stream at full rate fills the browser's DevTools
// connection, which the agent's commands then wait for.
//
// Server to viewer, binary: a kind byte, then for kind 0 a JPEG frame after the page's
// viewport in CSS pixels as two big-endian 16-bit integers; for kind 1 the video's MP4
// initialization segment; for kind 2 a keyframe flag byte and one frame's MP4 fragment. Text:
// {"type":"video","codec":..,"width":..,"height":..} before an initialization segment, with
// the viewport in CSS pixels; {"type":"tab"} when the streamed tab, its address or its title
// changes; {"type":"dialog", ...} while a JavaScript dialog is open and
// {"type":"dialog","open":false} when it closes. Viewer to server: JSON text, see
// viewerMessage.
import { activateTab, listTabs, openBrowser, setLiveViewport, windowChrome } from "./project-browser-control.mjs";
import { InputSender, viewerMessage } from "./project-browser-input.mjs";
import { AreaEncoder } from "./project-browser-video.mjs";

const JPEG_FRAME = 0;
const VIDEO_INIT = 1;
const VIDEO_FRAGMENT = 2;

// JPEG stream settings while only viewers act, and while the agent acts. Chromium sends the
// next frame once the last one is acknowledged, so a delayed acknowledgement limits the rate.
const VIEWER_STREAM = { quality: 90, frameIntervalMs: 0 };
const AGENT_STREAM = { quality: 75, frameIntervalMs: 50 };
const MAX_FRAME_SIDE = 4096;
// JPEG frames a viewer may have unacknowledged, and bytes the router may hold for it, before
// it misses the frames after them. A video viewer with more waiting skips to the next keyframe.
const FRAMES_IN_FLIGHT = 2;
const MAX_BUFFERED = 16 * 1024 * 1024;
const MAX_VIDEO_BUFFERED = 4 * 1024 * 1024;
const FOLLOW_INTERVAL_MS = 1_000;
// Chromium keeps a window at least 500 pixels wide.
const MIN_WINDOW_WIDTH = 500;
// The agent halves a screenshot until its long edge is at most 1568 pixels and clicks at CSS
// pixels read from it; a 2x screenshot matches CSS pixels only from this long edge on.
const SHARP_MIN_EDGE = 785;
// Input on the page within this long after a viewer's own is the viewer's; a navigation
// within the longer time after a viewer's action is the viewer's.
const OWN_INPUT_MS = 1_000;
const OWN_NAVIGATION_MS = 10_000;
// How long after its last action the agent counts as acting: longer than it usually thinks
// between a screenshot and the click it reads from it.
const AGENT_QUIET_MS = 30_000;

// A link or form the page follows was pressed by someone: the agent, unless a viewer was.
const PRESSED_NAVIGATIONS = new Set(["anchorClick", "formSubmissionGet", "formSubmissionPost"]);

// Records the time of the last trusted input in an isolated world, which the page's own
// scripts cannot see. The router reads it once a second.
const ACTIVITY_WORLD = "volition-live-view";
const ACTIVITY_SCRIPT = `var lastInput = 0;
for (const type of ["pointerdown", "keydown", "input", "wheel"]) {
  addEventListener(type, (event) => { if (event.isTrusted) lastInput = Date.now(); }, { capture: true, passive: true });
}`;

// The page size for a view: its CSS size, and the window pixels per CSS pixel, which is 2 on
// a high-density screen where the agent's screenshots allow it and 1 otherwise. A page too
// narrow for a window is drawn wider and shown scaled down.
export function pageSize({ width, height, dpr }) {
  const ratio = dpr >= 1.5 && Math.max(width, height) >= SHARP_MIN_EDGE ? 2 : 1;
  return { width: Math.max(width, Math.ceil(MIN_WINDOW_WIDTH / ratio)), height, ratio };
}

// The page size for the most recent view: while the agent acts, the current CSS size, at
// ratio 1 for a JPEG stream, or nothing to change before one was set; otherwise the view's
// pageSize. Ratio 1 and 2 give the agent screenshots of the same size.
export function targetSize(viewport, current, agentActive, video) {
  if (!agentActive) return pageSize(viewport);
  if (!current) return null;
  return video ? current : { ...current, ratio: 1 };
}

// The area of the display the video grabs: the page below the window's tab strip and toolbar,
// in window pixels, with an even width and height as the encoder needs.
export function captureArea(size, chrome) {
  const even = (value) => Math.max(2, Math.floor(value / 2) * 2);
  return {
    x: 0,
    y: chrome.height,
    width: even(size.width * size.ratio),
    height: even(size.height * size.ratio),
  };
}

// The binary message of one JPEG frame. The frame's metadata gives the viewport in window
// pixels, which the pixel ratio and the page zoom make larger than CSS pixels.
export function frameMessage(jpeg, metadata, scale) {
  const cssPixels = (value) => Math.min(0xffff, Math.max(0, Math.round((value || 0) / scale)));
  const header = Buffer.alloc(5);
  header[0] = JPEG_FRAME;
  header.writeUInt16BE(cssPixels(metadata.deviceWidth), 1);
  header.writeUInt16BE(cssPixels(metadata.deviceHeight), 3);
  return Buffer.concat([header, jpeg]);
}

class Viewer {
  constructor(socket, send) {
    this.socket = socket;
    this.input = new InputSender(send);
    this.inFlight = 0;
    this.missed = false;
    this.viewport = null;
    this.waitingForKeyframe = true;
  }

  ready() {
    return this.inFlight < FRAMES_IN_FLIGHT && this.socket.bufferedAmount <= MAX_BUFFERED;
  }

  // Sends a JPEG frame unless the viewer has not drawn the earlier ones yet; it then gets the
  // newest frame once it catches up.
  offer(frame) {
    if (!frame) return;
    if (!this.ready()) {
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

  // Frames depend on the ones before them back to a keyframe, so a viewer that cannot keep
  // up misses frames up to the next keyframe.
  offerVideo(message, keyframe) {
    if (this.socket.bufferedAmount > MAX_VIDEO_BUFFERED) this.waitingForKeyframe = true;
    if (this.waitingForKeyframe && !keyframe) return;
    this.waitingForKeyframe = false;
    this.socket.send(message);
  }

  // The video from its initialization segment and the frames since the last keyframe.
  startVideo(video) {
    this.waitingForKeyframe = true;
    this.socket.send(JSON.stringify(video.announcement));
    this.socket.send(video.init);
    for (const { message, keyframe } of video.sinceKeyframe) this.offerVideo(message, keyframe);
  }
}

class ScreencastStream {
  constructor(port, display, onEnd) {
    this.port = port;
    this.display = display;
    this.onEnd = onEnd;
    this.viewers = new Set();
    this.connection = null;
    this.session = null;
    this.targetId = null;
    this.frame = null;
    this.screencastFrame = null;
    this.screencasting = false;
    this.pendingAck = null;
    this.nextAck = 0;
    this.encoder = null;
    this.video = null;
    this.videoFailed = false;
    this.zoom = 1;
    // The page size in effect.
    this.size = null;
    this.stream = VIEWER_STREAM;
    this.followAgent = true;
    this.dialog = null;
    this.activityContext = null;
    this.activityRead = null;
    this.lastInput = 0;
    this.ownInputAt = 0;
    this.viewerActionAt = 0;
    this.pageNavigationAt = 0;
    this.agentActiveAt = 0;
    this.resizeTimer = null;
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
    const viewer = new Viewer(socket, (method, params) => this.sendInput(method, params));
    this.viewers.add(viewer);
    if (this.dialog) socket.send(JSON.stringify(this.dialog));
    socket.on("message", (data, binary) => {
      if (!binary) this.receive(viewer, data.toString("utf8"));
    });
    socket.on("close", () => this.remove(viewer));
  }

  remove(viewer) {
    this.viewers.delete(viewer);
    if (this.viewers.size === 0) return this.end();
    this.resize();
    this.acknowledgeWhenWanted();
  }

  receive(viewer, data) {
    let message;
    try {
      message = viewerMessage(data);
    } catch {
      return;
    }
    if (message.ack) {
      viewer.acknowledge(this.frame);
      return this.acknowledgeWhenWanted();
    }
    if (message.viewport) {
      const first = !viewer.viewport;
      viewer.viewport = message.viewport;
      // The set keeps insertion order, so its last viewer with a view is the most recent.
      this.viewers.delete(viewer);
      this.viewers.add(viewer);
      if (first) this.welcome(viewer);
      return void this.resizeAfterReadingActivity();
    }
    if (message.followAgent !== undefined) {
      this.followAgent = message.followAgent;
      return void this.follow();
    }
    if (message.dialog) {
      if (this.session) {
        this.connection.send("Page.handleJavaScriptDialog", message.dialog, this.session).catch(() => {});
      }
      return;
    }
    for (const command of message.commands) viewer.input.dispatch(command);
  }

  // A viewer's first view: it gets what the stream shows now.
  welcome(viewer) {
    if (this.video && viewer.viewport.video) viewer.startVideo(this.video);
    else {
      viewer.offer(this.frame);
      this.acknowledgeWhenWanted();
    }
  }

  sendInput(method, params) {
    if (!this.session) return Promise.resolve();
    // A pointer move raises none of the events the activity script records.
    if (params.type !== "mouseMoved") this.ownInputAt = Date.now();
    return this.connection.send(method, params, this.session).catch(() => {});
  }

  noteViewerAction() {
    this.viewerActionAt = Date.now();
  }

  noteAgentActivity() {
    const wasQuiet = Date.now() - this.agentActiveAt >= AGENT_QUIET_MS;
    this.agentActiveAt = Date.now();
    if (wasQuiet) this.resize();
  }

  // The activity is read once a second; a view that changes size right after the agent's
  // input has to see that input first.
  async resizeAfterReadingActivity() {
    if (this.session) await this.readActivity(this.session).catch(() => {});
    this.resize();
  }

  wantsVideo() {
    const viewports = [...this.viewers].map((viewer) => viewer.viewport).filter(Boolean);
    return Boolean(this.display) && !this.videoFailed && viewports.length > 0 && viewports.every((view) => view.video);
  }

  // Applies the page size and stream settings for the most recent view and the agent's
  // activity, and does so again once the agent has been quiet long enough.
  resize() {
    clearTimeout(this.resizeTimer);
    const quietIn = this.agentActiveAt + AGENT_QUIET_MS - Date.now();
    if (quietIn > 0) this.resizeTimer = setTimeout(() => this.resize(), quietIn);
    const stream = quietIn > 0 ? AGENT_STREAM : VIEWER_STREAM;
    if (stream !== this.stream) {
      this.stream = stream;
      if (this.screencasting) this.startScreencast(this.session).catch(() => {});
    }
    const viewport = [...this.viewers].reverse().find((viewer) => viewer.viewport)?.viewport;
    const size = viewport && targetSize(viewport, this.size, quietIn > 0, this.wantsVideo());
    const current = this.size;
    if (size && !(current?.width === size.width && current.height === size.height && current.ratio === size.ratio)) {
      this.size = size;
      this.videoFailed = false;
      return void setLiveViewport(this.port, size)
        .catch(() => {})
        .then(() => this.updateMode());
    }
    void this.updateMode();
  }

  // Runs the encoder for the page area when every viewer plays video, and the JPEG screencast
  // otherwise.
  async updateMode() {
    if (this.ended || !this.session || !this.size) return;
    const chrome = windowChrome(this.port);
    const area = this.wantsVideo() && chrome && captureArea(this.size, chrome);
    if (!area) {
      this.stopVideo();
      if (!this.screencasting) await this.startScreencast(this.session).catch(() => {});
      return;
    }
    const current = this.encoder?.area;
    if (current && current.x === area.x && current.y === area.y && current.width === area.width && current.height === area.height) {
      return;
    }
    this.stopVideo();
    if (this.screencasting) {
      this.screencasting = false;
      this.pendingAck = null;
      await this.connection.send("Page.stopScreencast", {}, this.session).catch(() => {});
    }
    this.startVideo(area);
  }

  startVideo(area) {
    const encoder = new AreaEncoder({ ...this.display, ...area });
    this.encoder = encoder;
    const size = this.size;
    encoder.on("init", (init, codec) => {
      const announcement = {
        type: "video",
        codec,
        width: Math.round(size.width / this.zoom),
        height: Math.round(size.height / this.zoom),
      };
      this.video = { announcement, init: Buffer.concat([Buffer.from([VIDEO_INIT]), init]), sinceKeyframe: [] };
      for (const viewer of this.viewers) if (viewer.viewport?.video) viewer.startVideo(this.video);
    });
    encoder.on("fragment", (fragment, keyframe) => {
      if (!this.video) return;
      const message = Buffer.concat([Buffer.from([VIDEO_FRAGMENT, keyframe ? 1 : 0]), fragment]);
      if (keyframe) this.video.sinceKeyframe = [];
      this.video.sinceKeyframe.push({ message, keyframe });
      for (const viewer of this.viewers) if (viewer.viewport?.video) viewer.offerVideo(message, keyframe);
    });
    encoder.on("exit", (code) => {
      if (code === null || this.encoder !== encoder) return;
      // The JPEG screencast shows the page until the page size changes again.
      this.videoFailed = true;
      this.stopVideo();
      void this.updateMode();
    });
    encoder.start().catch(() => {
      if (this.encoder !== encoder) return;
      this.videoFailed = true;
      this.stopVideo();
      void this.updateMode();
    });
  }

  stopVideo() {
    this.encoder?.stop();
    this.encoder = null;
    this.video = null;
  }

  startScreencast(session) {
    this.screencasting = true;
    return this.connection.send(
      "Page.startScreencast",
      { format: "jpeg", quality: this.stream.quality, maxWidth: MAX_FRAME_SIDE, maxHeight: MAX_FRAME_SIDE },
      session,
    );
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const viewer of this.viewers) viewer.socket.send(data);
  }

  // Streams the tab the agent works in when the viewers follow the agent, and the tab in front
  // otherwise, and reads its page zoom and the agent's input on it. The agent's tab is brought
  // to the front first: a tab behind another is not drawn.
  async follow() {
    if (this.following || this.ended) return;
    this.following = true;
    try {
      const tabs = await listTabs(this.port);
      const agentTab = this.followAgent ? tabs.find((tab) => tab.agent) : null;
      const shown = agentTab ?? tabs.find((tab) => tab.active);
      if (agentTab && !agentTab.active) await activateTab(this.port, agentTab.id);
      if (shown && shown.id !== this.targetId) await this.attach(shown.id);
      else if (this.session) {
        await this.readZoom(this.session);
        await this.readActivity(this.session);
      }
    } catch {
      // The next pass tries again.
    } finally {
      this.following = false;
    }
  }

  // Page calls are answered by the browser, so a tab whose page waits on a dialog is attached
  // all the same; the calls its page answers come on the next passes.
  async attach(targetId) {
    const previous = this.session;
    this.session = null;
    this.targetId = targetId;
    this.screencasting = false;
    this.pendingAck = null;
    this.activityContext = null;
    this.setDialog(null);
    if (previous) this.connection.send("Target.detachFromTarget", { sessionId: previous }).catch(() => {});
    let sessionId;
    try {
      ({ sessionId } = await this.connection.send("Target.attachToTarget", { targetId, flatten: true }));
      await this.connection.send("Page.enable", {}, sessionId);
      this.session = sessionId;
    } catch (error) {
      if (sessionId) this.connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
      this.targetId = null;
      throw error;
    }
    this.broadcast({ type: "tab" });
    await this.updateMode();
  }

  // A zoom change repaints the page before it is read here, so the newest frame is sent
  // again with the new size, and the video is announced again with it.
  async readZoom(session) {
    const metrics = await this.connection.send("Page.getLayoutMetrics", {}, session);
    const zoom = metrics.cssVisualViewport?.zoom || 1;
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (this.screencastFrame && session === this.session) this.showFrame(this.screencastFrame);
    if (this.video) {
      const size = this.size;
      this.video.announcement = {
        ...this.video.announcement,
        width: Math.round(size.width / zoom),
        height: Math.round(size.height / zoom),
      };
      this.broadcast(this.video.announcement);
    }
  }

  // Trusted input that no viewer sent is the agent's.
  readActivity(session) {
    this.activityRead ??= this.readActivityOnce(session).finally(() => {
      this.activityRead = null;
    });
    return this.activityRead;
  }

  async readActivityOnce(session) {
    const send = (method, params) => this.connection.send(method, params, session);
    if (!this.activityContext) {
      const { frameTree } = await send("Page.getFrameTree");
      const world = await send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: ACTIVITY_WORLD,
      });
      await send("Runtime.evaluate", { expression: ACTIVITY_SCRIPT, contextId: world.executionContextId });
      this.activityContext = world.executionContextId;
    }
    let lastInput;
    try {
      ({ result: { value: lastInput } } = await send("Runtime.evaluate", {
        expression: "lastInput",
        contextId: this.activityContext,
        returnByValue: true,
      }));
    } catch (error) {
      // The world ends with its document.
      this.activityContext = null;
      throw error;
    }
    if (!(lastInput > this.lastInput)) return;
    this.lastInput = lastInput;
    const sinceOwnInput = lastInput - this.ownInputAt;
    if (sinceOwnInput < 0 || sinceOwnInput > OWN_INPUT_MS) this.noteAgentActivity();
  }

  // The navigation replaces the world readActivity reads, so the press that started it is
  // counted here.
  notePageNavigation(reason) {
    this.pageNavigationAt = Date.now();
    if (PRESSED_NAVIGATIONS.has(reason) && Date.now() - this.ownInputAt > OWN_INPUT_MS) {
      this.noteAgentActivity();
    }
  }

  // A navigation from outside the page that no viewer started is the agent's.
  noteNavigation() {
    this.activityContext = null;
    const now = Date.now();
    const recent = (time) => now - time <= OWN_NAVIGATION_MS;
    if (recent(this.pageNavigationAt) || recent(this.ownInputAt) || recent(this.viewerActionAt)) return;
    this.noteAgentActivity();
  }

  setDialog(dialog) {
    if (!dialog && !this.dialog) return;
    this.dialog = dialog;
    this.broadcast(dialog ?? { type: "dialog", open: false });
  }

  handleEvent({ method, params, sessionId }) {
    if (method.startsWith("Target.")) return this.handleTargetEvent(method, params);
    if (sessionId !== this.session) return;
    switch (method) {
      case "Page.screencastFrame":
        this.receiveFrame(params, sessionId);
        break;
      case "Page.screencastVisibilityChanged":
        if (!params.visible) void this.follow();
        break;
      case "Page.frameRequestedNavigation":
        if (params.frameId === this.targetId) this.notePageNavigation(params.reason);
        break;
      case "Page.frameNavigated":
        if (!params.frame.parentId) this.noteNavigation();
        break;
      // The dialog is drawn by the browser outside the page, so the stream does not show it.
      case "Page.javascriptDialogOpening":
        this.setDialog({
          type: "dialog",
          open: true,
          kind: params.type,
          message: params.message,
          defaultPrompt: params.defaultPrompt ?? "",
        });
        break;
      case "Page.javascriptDialogClosed":
        this.setDialog(null);
        break;
    }
  }

  handleTargetEvent(method, params) {
    if (method === "Target.detachedFromTarget" && params.sessionId === this.session) {
      this.session = null;
      this.targetId = null;
      this.setDialog(null);
      void this.follow();
    }
    if (method === "Target.targetInfoChanged" && params.targetInfo?.targetId === this.targetId) {
      this.broadcast({ type: "tab" });
    }
  }

  showFrame(screencastFrame) {
    this.screencastFrame = screencastFrame;
    this.frame = frameMessage(screencastFrame.jpeg, screencastFrame.metadata, (this.size?.ratio ?? 1) * this.zoom);
    for (const viewer of this.viewers) viewer.offer(this.frame);
  }

  receiveFrame({ data, metadata, sessionId: frameId }, session) {
    if (!this.screencasting) return;
    this.showFrame({ jpeg: Buffer.from(data, "base64"), metadata });
    this.pendingAck = { frameId, session };
    this.acknowledgeWhenWanted();
  }

  // Asks Chromium for the next frame once a viewer can take it, so it does not draw frames
  // that every viewer would miss.
  acknowledgeWhenWanted() {
    const pending = this.pendingAck;
    if (!pending || ![...this.viewers].some((viewer) => viewer.ready())) return;
    this.pendingAck = null;
    const delay = Math.max(0, this.nextAck - Date.now());
    this.nextAck = Date.now() + delay + this.stream.frameIntervalMs;
    const acknowledge = () => {
      if (this.session !== pending.session) return;
      this.connection
        .send("Page.screencastFrameAck", { sessionId: pending.frameId }, pending.session)
        .catch(() => {});
    };
    if (delay > 0) setTimeout(acknowledge, delay);
    else acknowledge();
  }

  // The page keeps its CSS size at the display's pixel ratio, so the layout the agent works on
  // does not change when the last viewer leaves; with a desktop viewer watching, the window
  // fills the screen again.
  end() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    clearTimeout(this.resizeTimer);
    this.stopVideo();
    this.onEnd();
    for (const viewer of this.viewers) viewer.socket.close(1011, "Browser unavailable");
    this.connection?.close();
    if (!this.size) return;
    const size = desktopViewers.get(this.port) ? null : { ...this.size, ratio: 1 };
    setLiveViewport(this.port, size).catch(() => {});
  }
}

const streams = new Map();
// Open desktop (VNC) connections, by DevTools port.
const desktopViewers = new Map();

// Adds a WebSocket as a viewer of the browser on the given DevTools port, whose display the
// video grabs. The first viewer starts the stream and the last one to leave ends it.
export function joinScreencast(port, display, socket) {
  let stream = streams.get(port);
  if (!stream) {
    stream = new ScreencastStream(port, display, () => {
      if (streams.get(port) === stream) streams.delete(port);
    });
    streams.set(port, stream);
    void stream.start();
  }
  stream.add(socket);
}

// A desktop (VNC) viewer sizes the display to its panel, so the windows fill the display
// unless a live view is watched.
export function watchDesktop(port, socket) {
  desktopViewers.set(port, (desktopViewers.get(port) ?? 0) + 1);
  socket.once("close", () => desktopViewers.set(port, desktopViewers.get(port) - 1));
  if (!streams.has(port)) setLiveViewport(port, null).catch(() => {});
}

// A toolbar action of a viewer, such as a navigation, which is not the agent's activity.
export function noteViewerAction(port) {
  streams.get(port)?.noteViewerAction();
}
