// The live view of a project browser: the tab the agent works in, or else the tab in front,
// streamed to every viewer on the browser's WebSocket, with each viewer's mouse, wheel and
// keyboard input sent to that tab.
//
// The stream is H.264 video grabbed from the project's X display (project-browser-video.mjs)
// for viewers that play it, and the DevTools screencast as JPEG frames for the others or when
// every encoder fails. The page is shown at the CSS size of the most recent viewer's view: the
// window keeper sizes the real window to it. Chromium draws at device scale factor 2 (see
// project-browser-control.mjs), and a viewer on a high-density screen gets frames at ratio 2,
// one to one, the others at ratio 1. The agent works on that same page. While the agent acts,
// the page keeps its CSS size, so the layout does not move between the agent's look at the
// page and its next action; a JPEG stream then also drops to ratio 1 and 20 frames a second,
// because a sharp JPEG stream at full rate fills the browser's DevTools connection, which the
// agent's commands then wait for.
//
// Video is adaptive: each viewer is put on the quality tier (project-browser-video.mjs) its
// last reported round trip and downlink, and its socket's backlog, afford, and viewers on the
// same tier share its encoder — at most one running encoder per tier, never one per viewer. A
// covered view (the browser tab behind another, a minimised window) reports itself hidden and
// gets no frames until shown again, at which point it gets a fresh one at once; a tier with no
// shown viewer left stops its encoder. Viewers that cannot or do not want to play video get the
// JPEG screencast at the same time, so one of them does not take video from the others.
//
// Server to viewer, binary: a kind byte, then for kind 0 a JPEG frame after the page's
// viewport in CSS pixels as two big-endian 16-bit integers; for kind 1 the video's MP4
// initialization segment; for kind 2 a keyframe flag byte and one frame's MP4 fragment. Text:
// {"type":"video","codec":..,"width":..,"height":..,"pageWidth":..,"pageHeight":..} before an
// initialization segment, with the viewport in CSS pixels at the page's zoom (which input is
// given in) and at 100 % (the size a view draws the frames at to show them one to one);
// {"type":"page","width":..,"height":..,"zoom":..} with the page's size in CSS pixels at 100 %
// and its zoom, whenever either changes, by which a view draws a JPEG frame one to one;
// {"type":"tab"} when the streamed tab, its address or its title
// changes; {"type":"dialog", ...} while a JavaScript dialog is open;
// {"type":"dialog","open":false} when it closes; {"type":"pong","t":..} answering a viewer's
// {"type":"ping","t":..}; {"type":"control","by":"agent"|"owner"} when who last acted on the
// page changes (informational only, see ScreencastStream's controlBy). Viewer to server: JSON
// text, see viewerMessage.
import { activateTab, isAgentTitle, listTabs, openBrowser, setLiveViewport, windowChrome } from "./project-browser-control.mjs";
import { InputSender, viewerMessage } from "./project-browser-input.mjs";
import { AreaEncoder, chooseTier, sameArea, TIERS } from "./project-browser-video.mjs";

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
// How far behind a video viewer may be (its socket's backlog, or what it has not yet
// acknowledged, see Viewer.unackedBytes) before it waits for the next keyframe instead of
// piling on frames it cannot show in time anyway: two of its tier's recent keyframes, since
// one can still be arriving when the next is sent, plus what the tier sends while a stats
// report makes its way back (videoAllowance). A fixed 512 KiB was less than one keyframe of a
// page at pixel ratio 2 (up to 1.5 MB on the bench): every frame after a keyframe was dropped
// and a viewer on the best tier saw one frame every two seconds.
const MIN_VIDEO_BACKLOG = 512 * 1024;
// How often a viewer reports what it received (STATS_INTERVAL_MS in useBrowserScreencast.ts),
// with room for a report that is a little late.
const STATS_REPORT_MS = 300;
// Keyframes of a tier remembered for its allowance.
const KEYFRAMES_KEPT = 3;
// How long a fresh video's own catch-up burst is given before its viewer's acknowledged
// receipt is trusted: long enough for one real stats report (sent every 200ms on the client,
// see useBrowserScreencast.ts) to have had time to arrive even over a slow connection.
const ACK_GRACE_MS = 1_000;
const FOLLOW_INTERVAL_MS = 1_000;
// How often a connected viewer's tier is reassessed from its last reported RTT and downlink
// and the socket's backlog, besides whenever a fresh measurement or a shown/hidden change
// arrives. A viewer without one yet (a fresh join, or one waiting out an area change) picks a
// tier the moment an encoder becomes possible, not on this schedule.
const TIER_INTERVAL_MS = 2_000;
// The window a tier's own recent encoder output is measured over, for chooseTier.
const ENCODE_WINDOW_MS = 3_000;
// The window a viewer measures its downlink over (THROUGHPUT_WINDOW_MS in
// useBrowserScreencast.ts). Its downlink is held against its tier's output only once both
// windows cover that tier alone: right after a tier starts, its first keyframe (over a
// megabyte at pixel ratio 2) makes its short output window read several times its real rate,
// while the viewer's window still holds the tier before, and the difference read as a
// shortfall dropped a viewer on a perfect connection to the worst tier every few seconds.
const DOWNLINK_WINDOW_MS = 4_000;
// The minimum span a tier's own kbps measurement must cover before it is trusted. Right after
// an encoder (re)starts, the window can hold just its opening keyframe plus the next frame a
// few milliseconds later: dividing that keyframe's size by a near-zero elapsed time produces an
// absurd kbps spike, which chooseTier's "strained" check then misreads as a real connection
// shortfall — dropping the tier, restarting its encoder, and reproducing the same spike again.
// Below this span, kbps() reports 0 (no meaningful data yet) rather than a number.
const MIN_KBPS_WINDOW_MS = 500;
// After an encoder fails, the stream tries video again after this long, doubling up to the
// maximum; an encoder that ran this long without failing clears the count.
const VIDEO_RETRY_MS = 5_000;
const VIDEO_RETRY_MAX_MS = 60_000;
const VIDEO_HEALTHY_MS = 30_000;
// How long a restart forced by one viewer's requestKeyframe protects a tier's encoder from
// another: restarting it is disruptive to every viewer on the tier, so a request is answered
// with the fresh keyframe the tier's encoder already just started with when one is recent
// enough, rather than restarting again.
const KEYFRAME_REQUEST_MIN_MS = 2_000;
// Chromium keeps a window at least 500 pixels wide.
const MIN_WINDOW_WIDTH = 500;
// browser-harness takes its screenshots in window pixels and clicks at CSS pixels
// (capture_screenshot and click_at_xy in its helpers.py), and Hermes halves a screenshot until
// its long edge is at most 1568 pixels: a 2x screenshot matches CSS pixels only from this long
// edge on. So while an agent is in the browser a smaller page is drawn at ratio 1.
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

// Whether a page at ratio 2 gives an agent screenshots it can click from (see SHARP_MIN_EDGE).
function agentSafeAt2({ width, height }) {
  return Math.max(width, height) >= SHARP_MIN_EDGE;
}

// The page size for a view: its CSS size, the pixels per CSS pixel of the frames (ratio 2 for
// a high-density screen when the browser draws at factor 2, 1 otherwise), and whether the page
// itself is drawn at ratio 1 (pin1): while an agent is in the browser (agentPresent), a page
// smaller than SHARP_MIN_EDGE, whose screenshots at ratio 2 would put the agent's clicks off
// by 2. A page too narrow for a window is drawn wider and shown scaled down. At ratio 1 an
// odd size is made even, one pixel larger, which the video needs: the frame then is the page
// to the pixel, and a view shows it one to one with that pixel cut off rather than stretched.
export function pageSize({ width, height, dpr }, agentPresent = false, scale = 2) {
  const pin1 = scale >= 2 && agentPresent && !agentSafeAt2({ width, height });
  const ratio = dpr >= 1.5 && scale >= 2 && !pin1 ? 2 : 1;
  const even = (value) => (ratio === 1 ? Math.ceil(value / 2) * 2 : value);
  return { width: even(Math.max(width, MIN_WINDOW_WIDTH / scale)), height: even(height), ratio, pin1 };
}

// The page size for the most recent view: while the agent acts, the current CSS size — with
// JPEG frames at ratio 1, and a page too small for the agent's screenshots drawn at ratio 1
// — or nothing to change before one was set; otherwise the view's pageSize, with
// agentPresent saying whether an agent is in the browser without acting right now.
export function targetSize(viewport, current, agentActive, video, agentPresent = false, scale = 2) {
  if (!agentActive) return pageSize(viewport, agentPresent, scale);
  if (!current) return null;
  const pin1 = scale >= 2 && !agentSafeAt2(current);
  return { ...current, ratio: video && !pin1 ? current.ratio : 1, pin1 };
}

// The area of the display the video grabs, in display pixels: the page below the window's tab
// strip and toolbar, with an even width and height as the encoder needs; and the size it is
// encoded at, the page at the frames' ratio.
export function captureArea(size, chrome) {
  const even = (value) => Math.max(2, Math.floor(value / 2) * 2);
  const scale = chrome.scale ?? 1;
  const ratio = Math.min(size.ratio, scale);
  return {
    x: 0,
    y: chrome.height * scale,
    width: even(size.width * scale),
    height: even(size.height * scale),
    outWidth: even(size.width * ratio),
    outHeight: even(size.height * ratio),
  };
}

// The binary message of one JPEG frame. The frame's metadata gives the viewport in DIP, which
// the page zoom makes larger than CSS pixels.
export function frameMessage(jpeg, metadata, zoom) {
  const cssPixels = (value) => Math.min(0xffff, Math.max(0, Math.round((value || 0) / zoom)));
  const header = Buffer.alloc(5);
  header[0] = JPEG_FRAME;
  header.writeUInt16BE(cssPixels(metadata.deviceWidth), 1);
  header.writeUInt16BE(cssPixels(metadata.deviceHeight), 3);
  return Buffer.concat([header, jpeg]);
}

// How many bytes a video viewer may be behind before it waits for the next keyframe: see
// MIN_VIDEO_BACKLOG. keyframeBytes is the largest recent keyframe of its tier, encodedKbps the
// tier's recent output and rttMs the viewer's round trip.
export function videoAllowance({ keyframeBytes = 0, encodedKbps = 0, rttMs = 0 }) {
  const windowSeconds = (STATS_REPORT_MS + Math.min(rttMs, 1_000)) / 1000;
  return Math.max(MIN_VIDEO_BACKLOG, Math.round(2 * keyframeBytes + encodedKbps * 125 * windowSeconds));
}

class Viewer {
  constructor(socket, send) {
    this.socket = socket;
    this.input = new InputSender(send);
    // When the view last joined or changed size, which makes it the one the page follows.
    this.drivenAt = 0;
    this.inFlight = 0;
    this.missed = false;
    this.viewport = null;
    this.waitingForKeyframe = true;
    // Whether the view is covered (another browser tab, a minimised window): set by the
    // viewer, which then gets no frames until it is shown again, at which point it gets a
    // fresh one right away rather than the tier's usual keyframe interval.
    this.hidden = false;
    // The index into TIERS this viewer's video is encoded at, or null before one is chosen.
    this.tierIndex = null;
    this.rttMs = 0;
    this.downlinkKbps = 0;
    // When its last stats report arrived; stays fresh for a while after joining, so it is not
    // read as stale before the first one has had a chance to.
    this.lastStatsAt = Date.now();
    // Video bytes sent to this viewer, and the most recent count it has itself reported
    // receiving (a videoAck, see receive()): both running totals since its video last
    // (re)started, so what it is sent but has not answered for is exact, not a rate estimate,
    // and not thrown off by Node's own write buffer, which the kernel and the network both
    // hide far more from than it. Reset whenever a fresh video starts for it, so a slow
    // catch-up right after a tier or area change is not read as an already-stale answer.
    this.sentBytes = 0;
    this.receivedBytes = 0;
    // When this reset last happened: a burst as large as the tier's own keyframe interval can
    // be sent in the same tick a fresh video starts (the catch-up burst since the last
    // keyframe, in startVideo below), before its viewer has had any chance to acknowledge
    // even the first byte of it. Read as unacked that soon, it looks exactly like the stall it
    // is meant to detect; chooseTier ignores the acknowledgement past this until one real
    // report has had time to arrive.
    this.videoStartedAt = 0;
    this.lastKeyframeRequestAt = 0;
    // When chooseTier last dropped this viewer straight to the worst tier (a real backlog,
    // stale feedback, or a shortfall — see chooseTier's droppedAgoMs): 0 (long before any real
    // timestamp) until the first one, so the cooldown it starts never applies before then.
    this.lastDroppedAt = 0;
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

  // How much this viewer has been sent but has not yet answered for (see receive()'s
  // "stats" handling): the true measure of how far behind it is, immune to Node's own write
  // buffer, which the kernel and the network both hide far more behind than it ever shows.
  unackedBytes() {
    return Math.max(0, this.sentBytes - this.receivedBytes);
  }

  // How far behind this viewer is: what it has been sent but not acknowledged, or its
  // socket's own backlog if that is larger. Neither counts during the burst a fresh video
  // starts with (see startVideo), before the viewer has had a chance to acknowledge it.
  backlogBytes() {
    if (Date.now() - this.videoStartedAt <= ACK_GRACE_MS) return 0;
    return Math.max(this.socket.bufferedAmount, this.unackedBytes());
  }

  // Frames depend on the ones before them back to a keyframe, so a viewer more than its
  // allowance behind (videoAllowance) misses frames up to the next keyframe.
  offerVideo(message, keyframe, allowance) {
    // The catch-up burst a fresh video starts with (see startVideo) can itself be as large as
    // the tier's own keyframe interval, sent before this viewer has had any chance to
    // acknowledge even its first byte; read that soon, it looks exactly like the stall this
    // is meant to catch, and would cut its own burst short.
    if (this.socket.bufferedAmount > allowance || this.backlogBytes() > allowance) this.waitingForKeyframe = true;
    if (this.waitingForKeyframe && !keyframe) return;
    this.waitingForKeyframe = false;
    this.sentBytes += message.length;
    this.socket.send(message);
  }

  // The video from its initialization segment and the frames since the last keyframe.
  startVideo(video, allowance) {
    this.waitingForKeyframe = true;
    this.sentBytes = 0;
    this.receivedBytes = 0;
    this.videoStartedAt = Date.now();
    this.socket.send(JSON.stringify(video.announcement));
    this.socket.send(video.init);
    for (const { message, keyframe } of video.sinceKeyframe) this.offerVideo(message, keyframe, allowance);
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
    // One AreaEncoder per quality tier in use, keyed by tier name, shared by every viewer on
    // that tier: never one per viewer. { encoder, video: { announcement, init, sinceKeyframe } }
    this.tiers = new Map();
    this.videoArea = null;
    // Whether the stream is in video mode: video viewers get video, not JPEG. Stays set while
    // the encoders are stopped for a resize, so they do not get JPEG in between.
    this.videoLive = false;
    // Encoder failures in a row, and when the last one was: video is tried again after a
    // growing pause (videoPossible), and at once when the page size changes.
    this.videoFailures = 0;
    this.videoFailedAt = 0;
    // Resizes in progress: the window and page are changing, no encoder starts meanwhile.
    this.resizing = 0;
    this.modeRun = null;
    this.modeWanted = false;
    // The page size last told to the viewers ({type:"page"}).
    this.pageMessage = null;
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
    // Purely informational, from the same activity signal the stream's own size and rate
    // already use: no lock. The real control lock and its "Übernehmen" arrive with the
    // browser gateway (see docs/volition-design-browser-gateway.md).
    this.controlBy = "owner";
    // Whether an agent's browser-harness session holds a tab: it marks the tab's title while
    // attached (see listTabs), before it takes a screenshot to click from.
    this.agentInBrowser = false;
    // The display pixels per CSS pixel the browser draws at, as the window keeper measured it;
    // 2 until it has (see project-browser-control.mjs).
    this.scale = 2;
    this.resizeTimer = null;
    this.timer = null;
    this.tierTimer = null;
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
    this.tierTimer = setInterval(() => this.reassignTiers(), TIER_INTERVAL_MS);
    await this.follow();
  }

  add(socket) {
    const viewer = new Viewer(socket, (method, params) => this.sendInput(method, params));
    this.viewers.add(viewer);
    if (this.dialog) socket.send(JSON.stringify(this.dialog));
    if (this.pageMessage) socket.send(this.pageMessage);
    socket.send(JSON.stringify({ type: "control", by: this.controlBy }));
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
      viewer.acknowledge(this.getsJpeg(viewer) ? this.frame : null);
      return this.acknowledgeWhenWanted();
    }
    if (message.viewport) {
      const previous = viewer.viewport;
      viewer.viewport = message.viewport;
      // A view that joins or changes size takes the page's size (see drivingViewport); one
      // that only switches between video and JPEG, or repeats its size after a reconnect of
      // the router's side, does not take it from another viewer.
      const resized = !previous || ["width", "height", "dpr", "hold"].some((key) => previous[key] !== message.viewport[key]);
      if (resized) viewer.drivenAt = Date.now();
      if (previous && previous.video !== message.viewport.video) {
        viewer.tierIndex = null;
        viewer.waitingForKeyframe = true;
      }
      if (!previous || previous.video !== message.viewport.video) this.welcome(viewer);
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
    if (message.hidden !== undefined) return this.setViewerHidden(viewer, message.hidden);
    if (message.stats) {
      viewer.rttMs = message.stats.rttMs;
      viewer.downlinkKbps = message.stats.downlinkKbps;
      viewer.receivedBytes = Math.max(viewer.receivedBytes, message.stats.receivedBytes);
      viewer.lastStatsAt = Date.now();
      return this.reassignTiers();
    }
    if (message.requestKeyframe) return this.requestKeyframe(viewer);
    if (message.ping !== undefined) {
      viewer.socket.send(JSON.stringify({ type: "pong", t: message.ping }));
      return;
    }
    for (const command of message.commands) viewer.input.dispatch(command);
  }

  // A viewer whose own decoder fell far enough behind to give up on what it has queued asks
  // for a fresh keyframe rather than wait out its tier's keyframe interval. ffmpeg cannot be
  // told to produce one out of turn (see AreaEncoder), so its tier's encoder is restarted,
  // which starts with one as its very first frame — at the cost of every other viewer on that
  // tier getting a fresh keyframe too, which is why this is rate-limited per tier rather than
  // run for every request.
  requestKeyframe(viewer) {
    if (viewer.tierIndex === null) return;
    const tier = TIERS[viewer.tierIndex];
    const entry = this.tiers.get(tier.name);
    if (!entry) return;
    const now = Date.now();
    if (now - viewer.lastKeyframeRequestAt < KEYFRAME_REQUEST_MIN_MS) return;
    viewer.lastKeyframeRequestAt = now;
    if (now - (entry.startedAt ?? 0) < KEYFRAME_REQUEST_MIN_MS) return;
    entry.encoder.stop();
    this.tiers.delete(tier.name);
    this.startTierEncoder(tier);
  }

  // A covered view gets no frames; a view shown again gets a fresh one right away, whether or
  // not its tier's encoder kept running for another viewer meanwhile. The page takes the size
  // of the most recent view that is shown (see drivingViewport).
  setViewerHidden(viewer, hidden) {
    const was = viewer.hidden;
    viewer.hidden = hidden;
    if (was === hidden) return;
    if (!hidden) viewer.waitingForKeyframe = true;
    this.resize();
    if (hidden) return;
    this.reassignTiers();
    this.welcome(viewer);
  }

  // What a viewer that joined, was shown again or switched between video and JPEG gets: the
  // video of its tier from the last keyframe, or the newest JPEG frame.
  welcome(viewer) {
    if (viewer.hidden || !viewer.viewport) return;
    if (!this.getsJpeg(viewer)) {
      if (!this.videoArea) return;
      if (viewer.tierIndex === null) viewer.tierIndex = chooseTier(this.connectionOf(viewer), null);
      this.syncTierEncoders();
      this.resumeVideo(viewer);
    } else {
      viewer.offer(this.frame);
      this.acknowledgeWhenWanted();
    }
  }

  // The viewers that are shown and have told their view's size.
  shownViewers() {
    return [...this.viewers].filter((viewer) => viewer.viewport && !viewer.hidden);
  }

  // Whether a viewer gets the JPEG screencast: one that does not play video, or every viewer
  // while the stream has no video.
  getsJpeg(viewer) {
    return Boolean(viewer.viewport) && !viewer.hidden && !(viewer.viewport.video && this.videoLive);
  }

  // The view whose size the page takes: of the shown views that do not hold the page's size,
  // the one that most recently joined or changed size; else the page keeps its size. Every
  // other view shows the page scaled.
  drivingViewport() {
    let driver = null;
    for (const viewer of this.viewers) {
      if (!viewer.viewport || viewer.hidden || viewer.viewport.hold) continue;
      if (!driver || viewer.drivenAt > driver.drivenAt) driver = viewer;
    }
    return driver?.viewport ?? null;
  }

  // The view the page's size is taken from: the fixed size while the gateway holds one (an
  // agent steers), the driving view, or the page's own size — the first view's before it has
  // one — each with the highest pixel ratio of the shown views, so every one of them gets
  // frames as sharp as its screen.
  sizingViewport() {
    const shown = this.shownViewers();
    const dpr = Math.max(1, ...shown.map((viewer) => viewer.viewport.dpr));
    const authority = viewportAuthorities.get(this.port);
    if (authority?.mode === "fixed") return { ...authority.size, dpr };
    const driver = this.drivingViewport();
    if (driver) return { ...driver, dpr };
    if (this.size) return { width: this.size.width, height: this.size.height, dpr };
    const first = [...this.viewers].find((viewer) => viewer.viewport)?.viewport;
    return first ? { ...first, dpr } : null;
  }

  // How far behind a viewer may be on its tier before it waits for a keyframe.
  allowanceOf(viewer) {
    const entry = viewer.tierIndex === null ? null : this.tiers.get(TIERS[viewer.tierIndex].name);
    if (!entry) return videoAllowance({});
    return videoAllowance({ keyframeBytes: entry.keyframeBytes(), encodedKbps: entry.kbps(), rttMs: viewer.rttMs });
  }

  // A viewer's last reported round trip and downlink, how far behind its own acknowledged
  // receipt says it is (or, failing that, Node's own backlog figure) and how far it may be,
  // how long since its last stats report, and its tier's own recent encoder output once it can
  // be compared (see DOWNLINK_WINDOW_MS) — the last two give chooseTier a read on the
  // connection even when a backlog figure cannot.
  connectionOf(viewer) {
    const entry = viewer.tierIndex === null ? null : this.tiers.get(TIERS[viewer.tierIndex].name);
    const now = Date.now();
    const settled = entry && now - entry.startedAt >= ENCODE_WINDOW_MS && now - viewer.videoStartedAt >= DOWNLINK_WINDOW_MS;
    return {
      downlinkKbps: viewer.downlinkKbps,
      rttMs: viewer.rttMs,
      // Both figures are given a grace period after a video starts (see Viewer.backlogBytes):
      // startVideo can itself send a burst as large as the tier's own keyframe interval in one
      // tick, on a perfectly healthy connection, before the OS has even had a chance to drain
      // it — measured with two viewers on the same tier, a fast one's own burst briefly read as
      // its own congestion, and a real drop's tier stays off the table for a while (see
      // chooseTier's RETRY_COOLDOWN_MS).
      bufferedBytes: viewer.backlogBytes(),
      congestedBytes: this.allowanceOf(viewer),
      feedbackAgeMs: now - viewer.lastStatsAt,
      encodedKbps: settled ? entry.kbps() : 0,
      droppedAgoMs: now - viewer.lastDroppedAt,
    };
  }

  // Sends a viewer already on a running tier's encoder the burst since its last keyframe, so a
  // view that just connected or was just shown again starts at once instead of waiting out the
  // tier's keyframe interval. Does nothing when the tier's encoder has not produced one yet:
  // its "init" handler sends every viewer waiting on it their first burst once it has.
  resumeVideo(viewer) {
    if (!viewer.viewport?.video || viewer.hidden || viewer.tierIndex === null) return;
    const entry = this.tiers.get(TIERS[viewer.tierIndex].name);
    if (entry?.video) viewer.startVideo(entry.video, this.allowanceOf(viewer));
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

  // An agent that takes hold of a tab is noticed at once from the title it gives the tab (see
  // handleTargetEvent), and one that lets go on the next pass over the tabs.
  noteAgentInBrowser(present) {
    if (present === this.agentInBrowser) return;
    this.agentInBrowser = present;
    this.resize();
  }

  // Tells a fresh or changed control state to every viewer; a viewer that joins gets it in
  // add(). Informational only, see the field's own comment.
  broadcastControl() {
    const by = Date.now() - this.agentActiveAt < AGENT_QUIET_MS ? "agent" : "owner";
    if (by === this.controlBy) return;
    this.controlBy = by;
    this.broadcast({ type: "control", by });
  }

  // The activity is read once a second; a view that changes size right after the agent's
  // input has to see that input first.
  async resizeAfterReadingActivity() {
    if (this.session) await this.readActivity(this.session).catch(() => {});
    this.resize();
  }

  // Whether video may run: the stream knows the display, and no encoder failed just now. A
  // failed encoder is tried again after VIDEO_RETRY_MS, doubling up to VIDEO_RETRY_MAX_MS, and
  // at once for a new page size.
  videoPossible() {
    if (!this.display) return false;
    if (this.videoFailures === 0) return true;
    const pause = Math.min(VIDEO_RETRY_MAX_MS, VIDEO_RETRY_MS * 2 ** (this.videoFailures - 1));
    return Date.now() - this.videoFailedAt >= pause;
  }

  // Whether every shown viewer plays video, which lets the page keep its pixel ratio while
  // the agent acts (see targetSize).
  allVideo() {
    const shown = this.shownViewers();
    return this.videoPossible() && shown.length > 0 && shown.every((viewer) => viewer.viewport.video);
  }

  // Applies the page size and stream settings for the most recent view and the agent's
  // activity, and does so again once the agent has been quiet long enough.
  resize() {
    clearTimeout(this.resizeTimer);
    const quietIn = this.agentActiveAt + AGENT_QUIET_MS - Date.now();
    if (quietIn > 0) this.resizeTimer = setTimeout(() => this.resize(), quietIn);
    this.broadcastControl();
    const stream = quietIn > 0 ? AGENT_STREAM : VIEWER_STREAM;
    if (stream !== this.stream) {
      this.stream = stream;
      if (this.screencasting) this.startScreencast(this.session).catch(() => {});
    }
    const viewport = this.sizingViewport();
    this.scale = windowChrome(this.port)?.scale ?? this.scale;
    const size = viewport && targetSize(viewport, this.size, quietIn > 0, this.allVideo(), this.agentInBrowser, this.scale);
    const current = this.size;
    const same = current && ["width", "height", "ratio", "pin1"].every((key) => current[key] === size?.[key]);
    if (size && !same) {
      this.size = size;
      this.videoFailures = 0;
      // The window changes size now. An encoder grabbing it meanwhile would send the page
      // while it is laid out again (and, pinned at ratio 2, drawn at half size in a corner of
      // its window), so the encoders stop first: every viewer keeps showing its last frame
      // until the page has its new size, has drawn it, and new encoders start on it.
      this.stopAllTiers();
      this.resizing++;
      return void setLiveViewport(this.port, size)
        .catch(() => {})
        .finally(() => {
          this.resizing--;
          this.announcePage();
          // The JPEG frames' size follows the page's size and ratio.
          if (this.screencasting && this.session) this.startScreencast(this.session).catch(() => {});
          void this.updateMode();
        });
    }
    this.announcePage();
    void this.updateMode();
  }

  // Tells the viewers the page's size once it has it, for them to show frames one to one.
  announcePage() {
    if (!this.size || this.resizing) return;
    const fixed = viewportAuthorities.get(this.port)?.mode === "fixed";
    const message = JSON.stringify({ type: "page", width: this.size.width, height: this.size.height, zoom: this.zoom, fixed });
    if (message === this.pageMessage) return;
    this.pageMessage = message;
    for (const viewer of this.viewers) viewer.socket.send(message);
  }

  // Runs one encoder per quality tier a shown video viewer is on, and the JPEG screencast
  // while a shown viewer gets JPEG. Runs once at a time, and once more when it was asked
  // again meanwhile.
  updateMode() {
    this.modeWanted = true;
    this.modeRun ??= (async () => {
      try {
        while (this.modeWanted) {
          this.modeWanted = false;
          await this.applyMode();
        }
      } finally {
        this.modeRun = null;
      }
    })();
    return this.modeRun;
  }

  async applyMode() {
    if (this.ended || !this.session || !this.size || this.resizing) return;
    const chrome = windowChrome(this.port);
    const wanted = this.videoPossible() && this.shownViewers().some((viewer) => viewer.viewport.video);
    const area = wanted && chrome ? captureArea(this.size, chrome) : null;
    this.videoLive = Boolean(area);
    if (!area) this.stopAllTiers();
    else {
      if (!sameArea(this.videoArea, area)) {
        this.stopAllTiers();
        this.videoArea = area;
      }
      this.assignMissingTiers();
      this.syncTierEncoders();
    }
    const jpeg = this.shownViewers().some((viewer) => this.getsJpeg(viewer));
    if (jpeg && !this.screencasting) await this.startScreencast(this.session).catch(() => {});
    else if (!jpeg && this.screencasting) await this.stopScreencast();
  }

  // Gives a video viewer without a tier yet — a fresh join, or one that was waiting out an
  // area change — the best one its last measurement affords.
  assignMissingTiers() {
    for (const viewer of this.viewers) {
      if (viewer.viewport?.video && !viewer.hidden && viewer.tierIndex === null) {
        viewer.tierIndex = chooseTier(this.connectionOf(viewer), null);
      }
    }
  }

  // Reassesses every shown video viewer's tier from its last measurement, on the fixed
  // schedule and whenever a fresh one arrives, and starts or stops encoders to match.
  reassignTiers() {
    if (!this.videoArea) return;
    for (const viewer of this.viewers) {
      if (!viewer.viewport?.video || viewer.hidden) continue;
      const before = viewer.tierIndex;
      viewer.tierIndex = chooseTier(this.connectionOf(viewer), before);
      // A straight drop to the worst tier is chooseTier's hard-drop path (a real backlog,
      // stale feedback, or a shortfall), never the ordinary one-step kind: recorded here, not
      // inside chooseTier, so it stays a pure function of one measurement and an index.
      if (viewer.tierIndex === TIERS.length - 1 && before !== TIERS.length - 1) {
        viewer.lastDroppedAt = Date.now();
      }
    }
    this.syncTierEncoders();
  }

  // Starts the encoder of every tier a shown video viewer is now on, and stops one that has
  // none left: at most one running encoder per tier, shared by every viewer on it.
  syncTierEncoders() {
    if (!this.videoArea) return;
    const wanted = new Set();
    for (const viewer of this.viewers) {
      if (viewer.viewport?.video && !viewer.hidden && viewer.tierIndex !== null) {
        wanted.add(TIERS[viewer.tierIndex].name);
      }
    }
    for (const [name, entry] of this.tiers) {
      if (!wanted.has(name)) {
        entry.encoder.stop();
        this.tiers.delete(name);
      }
    }
    for (const name of wanted) {
      if (!this.tiers.has(name)) {
        this.startTierEncoder(TIERS.find((tier) => tier.name === name));
      }
    }
  }

  startTierEncoder(tier) {
    const encoder = new AreaEncoder({ ...this.display, ...this.videoArea, tier });
    // bytesWindow tracks what this tier's own encoder has produced over the last
    // ENCODE_WINDOW_MS, so chooseTier can tell a slow connection from a quiet page: the
    // former's viewers report a downlink well under what the encoder is actually producing.
    // keyframes holds the sizes of its last few keyframes, for its viewers' allowance.
    const entry = { encoder, video: null, bytesWindow: [], windowBytes: 0, keyframes: [], startedAt: Date.now() };
    entry.kbps = () => {
      const cutoff = Date.now() - ENCODE_WINDOW_MS;
      while (entry.bytesWindow.length && entry.bytesWindow[0].at < cutoff) {
        entry.windowBytes -= entry.bytesWindow.shift().bytes;
      }
      if (entry.bytesWindow.length < 2) return 0;
      const spanMs = Date.now() - entry.bytesWindow[0].at;
      if (spanMs < MIN_KBPS_WINDOW_MS) return 0;
      return Math.round((entry.windowBytes * 8) / 1000 / (spanMs / 1000));
    };
    entry.keyframeBytes = () => Math.max(0, ...entry.keyframes);
    this.tiers.set(tier.name, entry);
    const size = this.size;
    const onTier = (viewer) => viewer.viewport?.video && !viewer.hidden && TIERS[viewer.tierIndex ?? -1]?.name === tier.name;
    encoder.on("init", (init, codec) => {
      entry.video = {
        announcement: {
          type: "video",
          codec,
          tier: tier.name,
          width: Math.round(size.width / this.zoom),
          height: Math.round(size.height / this.zoom),
          pageWidth: size.width,
          pageHeight: size.height,
        },
        init: Buffer.concat([Buffer.from([VIDEO_INIT]), init]),
        sinceKeyframe: [],
      };
      for (const viewer of this.viewers) if (onTier(viewer)) viewer.startVideo(entry.video, this.allowanceOf(viewer));
    });
    encoder.on("fragment", (fragment, keyframe) => {
      if (!entry.video) return;
      const message = Buffer.concat([Buffer.from([VIDEO_FRAGMENT, keyframe ? 1 : 0]), fragment]);
      entry.bytesWindow.push({ at: Date.now(), bytes: message.length });
      entry.windowBytes += message.length;
      if (keyframe) {
        entry.video.sinceKeyframe = [];
        entry.keyframes.push(message.length);
        if (entry.keyframes.length > KEYFRAMES_KEPT) entry.keyframes.shift();
      }
      entry.video.sinceKeyframe.push({ message, keyframe });
      if (this.videoFailures && Date.now() - entry.startedAt > VIDEO_HEALTHY_MS) this.videoFailures = 0;
      for (const viewer of this.viewers) if (onTier(viewer)) viewer.offerVideo(message, keyframe, this.allowanceOf(viewer));
    });
    const failed = () => {
      if (this.tiers.get(tier.name)?.encoder !== encoder) return;
      // The JPEG screencast shows the page meanwhile; video is tried again after a pause
      // (videoPossible), or at once when the page size changes.
      this.videoFailures++;
      this.videoFailedAt = Date.now();
      this.stopAllTiers();
      void this.updateMode();
    };
    encoder.on("exit", (code) => {
      if (code !== null) failed();
    });
    encoder.start().catch(failed);
  }

  stopAllTiers() {
    for (const entry of this.tiers.values()) entry.encoder.stop();
    this.tiers.clear();
    this.videoArea = null;
  }

  async stopScreencast() {
    this.screencasting = false;
    this.pendingAck = null;
    this.frame = null;
    this.screencastFrame = null;
    if (this.session) await this.connection.send("Page.stopScreencast", {}, this.session).catch(() => {});
  }

  startScreencast(session) {
    this.screencasting = true;
    return this.connection.send(
      "Page.startScreencast",
      {
        format: "jpeg",
        quality: this.stream.quality,
        // Frames at the page's ratio for the viewers: a browser drawing at factor 2 sends
        // ratio 1 frames scaled down.
        maxWidth: Math.min(MAX_FRAME_SIDE, Math.round((this.size?.width ?? MAX_FRAME_SIDE) * (this.size?.ratio ?? 1))),
        maxHeight: Math.min(MAX_FRAME_SIDE, Math.round((this.size?.height ?? MAX_FRAME_SIDE) * (this.size?.ratio ?? 1))),
      },
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
      this.noteAgentInBrowser(tabs.some((tab) => tab.agent));
      const agentTab = this.followAgent ? tabs.find((tab) => tab.agent) : null;
      const shown = agentTab ?? tabs.find((tab) => tab.active);
      if (agentTab && !agentTab.active) await activateTab(this.port, agentTab.id);
      if (shown && shown.id !== this.targetId) await this.attach(shown.id);
      else if (this.session) {
        await this.readZoom(this.session);
        await this.readActivity(this.session);
        // Picks up what changed without a resize: a video retry that is due, the window
        // keeper's first measurement of the toolbar after a restart, or of the factor the
        // browser draws at.
        if ((windowChrome(this.port)?.scale ?? this.scale) !== this.scale) this.resize();
        else void this.updateMode();
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
  // again with the new size, and every tier's video is announced again with it. Each viewer
  // gets its own tier's announcement directly, since tiers can differ in codec.
  async readZoom(session) {
    const metrics = await this.connection.send("Page.getLayoutMetrics", {}, session);
    const zoom = metrics.cssVisualViewport?.zoom || 1;
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.announcePage();
    if (this.screencastFrame && session === this.session) this.showFrame(this.screencastFrame);
    if (this.tiers.size === 0) return;
    const size = this.size;
    for (const entry of this.tiers.values()) {
      if (!entry.video) continue;
      entry.video.announcement = {
        ...entry.video.announcement,
        width: Math.round(size.width / zoom),
        height: Math.round(size.height / zoom),
      };
    }
    for (const viewer of this.viewers) {
      if (!viewer.viewport?.video || viewer.hidden || viewer.tierIndex === null) continue;
      const entry = this.tiers.get(TIERS[viewer.tierIndex].name);
      if (entry?.video) viewer.socket.send(JSON.stringify(entry.video.announcement));
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
    if (method === "Target.targetInfoChanged" && params.targetInfo?.type === "page" && isAgentTitle(params.targetInfo.title)) {
      this.noteAgentInBrowser(true);
    }
    if (method === "Target.targetInfoChanged" && params.targetInfo?.targetId === this.targetId) {
      this.broadcast({ type: "tab" });
    }
  }

  showFrame(screencastFrame) {
    this.screencastFrame = screencastFrame;
    this.frame = frameMessage(screencastFrame.jpeg, screencastFrame.metadata, this.zoom);
    for (const viewer of this.viewers) if (this.getsJpeg(viewer)) viewer.offer(this.frame);
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
    if (!pending || ![...this.viewers].some((viewer) => this.getsJpeg(viewer) && viewer.ready())) return;
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
    clearInterval(this.tierTimer);
    clearTimeout(this.resizeTimer);
    this.stopAllTiers();
    this.onEnd();
    for (const viewer of this.viewers) viewer.socket.close(1011, "Browser unavailable");
    this.connection?.close();
    if (!this.size) return;
    // Nobody watches to see an agent come: a page too small for its screenshots at ratio 2 is
    // drawn at ratio 1 from now on.
    const pin1 = this.scale >= 2 && Math.max(this.size.width, this.size.height) < SHARP_MIN_EDGE;
    const size = desktopViewers.get(this.port) ? null : { ...this.size, ratio: 1, pin1 };
    setLiveViewport(this.port, size).catch(() => {});
  }
}

const streams = new Map();
// Open desktop (VNC) connections, by DevTools port.
const desktopViewers = new Map();
// Who decides a browser's page size, by DevTools port: absent for "follow" (the driving view,
// see drivingViewport), or { mode: "fixed", size } while the browser gateway holds a working
// size for an agent that steers.
const viewportAuthorities = new Map();
export const FIXED_VIEWPORT = { width: 1440, height: 900 };

// Hands a browser's page size to the viewers ("follow") or holds it at a size ("fixed", the
// browser gateway while an agent steers: FIXED_VIEWPORT unless it gives one), so the agent's
// layout, snapshots and references do not change when a person resizes a panel; the views then
// show the page scaled. Applies at once, whether or not anyone watches.
export function setViewportAuthority(port, mode, size) {
  if (mode !== "follow" && mode !== "fixed") throw new Error("Unknown viewport mode");
  if (mode === "follow") viewportAuthorities.delete(port);
  else {
    const valid = (value, max) => Number.isInteger(value) && value >= 250 && value <= max;
    const fixed = size ?? FIXED_VIEWPORT;
    if (!valid(fixed.width, 8192) || !valid(fixed.height, 8192)) throw new Error("Invalid viewport size");
    viewportAuthorities.set(port, { mode, size: { width: fixed.width, height: fixed.height } });
  }
  const stream = streams.get(port);
  if (stream) return stream.resize();
  if (mode === "fixed") {
    const { width, height } = viewportAuthorities.get(port).size;
    setLiveViewport(port, { width, height, ratio: 1, pin1: false }).catch(() => {});
  }
}

export function viewportAuthority(port) {
  const authority = viewportAuthorities.get(port);
  return authority ? { mode: authority.mode, ...authority.size } : { mode: "follow" };
}

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
