import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { openBrowser, startWindowKeeper, windowChrome } from "./project-browser-control.mjs";
import { BrowserIdle, setPageLifecycle } from "./project-browser-idle.mjs";
import { setControlState } from "./project-browser-screencast.mjs";
import { createProjectBrowserRouter, shutdownProjectBrowserRouter } from "./project-router.mjs";

// Explicit native proof: its own CPU Chromium, display, router and synthetic page only.
// HELENA_PROOF_SCREEN (default 3200x2000) is the display's size in pixels: 1920x1080 proves the
// project browsers' Full HD display (volition-project-browser-kasm@.service), where a page
// larger than 960x540 CSS pixels at factor 2 has a window larger than the screen.
const [screenWidth, screenHeight] = (process.env.HELENA_PROOF_SCREEN || "3200x2000").split("x").map(Number);
const directory = await mkdtemp(path.join(os.tmpdir(), "helena-resize-proof-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (value) => console.log(JSON.stringify(value));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
async function until(check, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

function jpegSize(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8);
  for (let offset = 2; offset + 8 < buffer.length;) {
    assert.equal(buffer[offset++], 0xff);
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    assert.notEqual(marker, 0xda, "JPEG has no frame dimensions before scan");
    const length = buffer.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= buffer.length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
    offset += length;
  }
  throw new Error("JPEG has no supported dimensions");
}

const page = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<title>Helena synthetic resize proof</title><style>body{margin:0}button{position:fixed;left:10px;top:10px;width:100px;height:40px}</style><button onclick='window.clicks++'>Fixture</button><script>window.clicks=0;window.ticks=0;window.points=[];addEventListener('mousedown',(e)=>window.points.push([e.clientX,e.clientY]));setInterval(()=>{document.body.style.background=++window.ticks%2?'steelblue':'seagreen'},80)</script>");
});
let xserver, chromium, connection, router, idle, stopKeeper, viewer;
let phase = "setup";
let cdpPort;
const children = [];
const failures = [];
const hardDeadline = setTimeout(() => {
  emit({ success: false, phase, error: "Native proof exceeded 90 seconds" });
  for (const child of children) child.kill("SIGKILL");
  process.exit(1);
}, 90_000);
try {
  const url = `http://127.0.0.1:${await listen(page)}/`;
  xserver = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", `${screenWidth}x${screenHeight}x24`, "-nolisten", "tcp"],
    { stdio: ["ignore", "ignore", "ignore", "pipe"] });
  children.push(xserver);
  let display;
  xserver.once("error", (error) => failures.push(error));
  xserver.stdio[3].once("data", (chunk) => { display = chunk.toString().trim(); });
  await until(() => { if (failures.length) throw failures[0]; return display; }, "private display", 5_000);
  assert.match(display, /^\d+$/);
  chromium = spawn("chromium", [
    `--user-data-dir=${path.join(directory, "profile")}`, "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1", "--ozone-platform=x11", "--force-device-scale-factor=2",
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-proxy-server",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "--disable-features=MediaRouter,OptimizationHints", url,
  ], { env: { PATH: process.env.PATH, HOME: directory, DISPLAY: `:${display}` }, stdio: "ignore" });
  children.push(chromium);
  chromium.once("error", (error) => failures.push(error));
  await until(async () => {
    if (failures.length) throw failures[0];
    assert.equal(chromium.exitCode, null);
    try { cdpPort = Number((await readFile(path.join(directory, "profile", "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch {}
    return cdpPort;
  }, "private Chromium");
  connection = await openBrowser(cdpPort);
  const targets = async () => (await connection.send("Target.getTargets")).targetInfos.filter((target) => target.type === "page");
  const target = await until(async () => (await targets()).find((value) => value.url === url), "fixture target");
  assert.equal((await targets()).length, 1);
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const navigation = await connection.send("Page.navigate", { url }, sessionId);
  assert.equal(navigation.errorText, undefined);
  const evaluate = async (expression) => (await connection.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
  const geometry = () => evaluate("[innerWidth,innerHeight,devicePixelRatio,outerWidth,outerHeight]");
  await until(async () => {
    const state = await evaluate("[location.href,document.readyState,window.ticks]");
    return state?.[0] === url && Number.isInteger(state[2]);
  }, "synthetic fixture").catch(async (error) => {
    emit({ phase: "fixture-diagnostic", value: await evaluate("[location.href,document.readyState,document.body?.textContent?.slice(0,300),window.ticks]") });
    throw error;
  });
  const root = path.join(directory, "projects");
  await mkdir(path.join(root, "fixture"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "fixture", "runtime.json"), JSON.stringify({
    schemaVersion: 1, slug: "fixture", cdpPort, noVncPort: page.address().port,
  }), { mode: 0o600 });
  const listBrowsers = async () => [{ slug: "fixture", cdpPort }];
  setControlState(cdpPort, { holder: null, since: null });
  idle = new BrowserIdle({ listBrowsers, log: (message) => failures.push(new Error(message)) });
  router = createProjectBrowserRouter({ root, idle });
  const routerPort = await listen(router);
  stopKeeper = startWindowKeeper({ listBrowsers, log: (message) => failures.push(new Error(message)) });

  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${routerPort}/projects/fixture/api/screencast`);
    socket.binaryType = "arraybuffer";
    const received = { frames: [], pages: [] };
    socket.addEventListener("error", () => failures.push(new Error("Viewer socket failed")));
    socket.addEventListener("message", (event) => {
      try {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          if (message.type === "page") received.pages.push(message);
          return;
        }
        const bytes = Buffer.from(event.data);
        assert.ok(bytes[0] === 0 || bytes[0] === 3, "Expected JPEG transport");
        received.frames.push({ kind: bytes[0], css: [bytes.readUInt16BE(1), bytes.readUInt16BE(3)], pixels: jpegSize(bytes.subarray(bytes[0] === 3 ? 9 : 5)), hash: createHash("sha256").update(bytes).digest("hex") });
        if (received.frames.length > 40) received.frames.shift();
        socket.send(JSON.stringify({ type: "ack" }));
      } catch (error) { failures.push(error); }
    });
    await until(() => socket.readyState === WebSocket.OPEN, "viewer connected");
    socket.send(JSON.stringify({ type: "hidden", hidden: false }));
    socket.send(JSON.stringify({ type: "follow", agent: true }));
    return { socket, received };
  }
  async function resize(width, height) {
    const { socket, received } = viewer;
    received.frames.length = 0;
    received.pages.length = 0;
    const matches = (frame) => frame.kind === 0 && frame.css[0] === width && frame.css[1] === height &&
      frame.pixels[0] === width * 2 && frame.pixels[1] === height * 2;
    socket.send(JSON.stringify({ type: "viewport", width, height, dpr: 2, video: false, hold: false }));
    await until(async () => {
      if (failures.length) throw failures[0];
      const current = await geometry();
      return current[0] === width && current[1] === height && current[2] === 2 &&
        received.frames.filter(matches).length >= 3;
    }, `${phase} actual CSS and fresh JPEG dimensions`).catch(async (error) => {
      emit({ phase: "resize-diagnostic", requested: [width, height], actual: await geometry(), crop: windowChrome(cdpPort),
        frames: received.frames.slice(-3).map(({ kind, css, pixels }) => ({ kind, css, pixels })), pages: received.pages });
      throw error;
    });
    assert.ok(received.pages.some((value) => value.width === width && value.height === height && value.fixed === false));
    const matching = received.frames.filter(matches);
    assert.ok(new Set(matching.map((frame) => frame.hash)).size >= 2, "Fresh synthetic animation expected");
    for (const frame of matching) assert.deepEqual(frame.pixels, [width * 2, height * 2]);
    const actual = await geometry();
    const crop = windowChrome(cdpPort);
    assert.ok(crop && crop.scale === 2 && crop.height > 0);
    const { bounds } = await connection.send("Browser.getWindowForTarget", { targetId: target.targetId });
    assert.equal(bounds.width, width + crop.width);
    assert.equal(bounds.height, height + crop.height);
    assert.deepEqual((await targets()).map((value) => value.targetId), [target.targetId]);
    // Click accuracy (docs/volition-design-browser-perfekt.md §5.3): corners and centre land on
    // the CSS pixel asked for, also where the window is larger than the display.
    const targetsToClick = [[3, 3], [Math.floor(width / 2), Math.floor(height / 2)], [width - 4, height - 4], [width - 4, 3], [3, height - 4]];
    await evaluate("window.points.length = 0");
    for (const [x, y] of targetsToClick) {
      socket.send(JSON.stringify({ type: "mouse", event: "click", x, y, button: "left" }));
    }
    const points = await until(async () => {
      const value = await evaluate("window.points");
      return value?.length >= targetsToClick.length ? value : null;
    }, `${phase} clicks`);
    for (const [index, [x, y]] of targetsToClick.entries()) {
      const [clientX, clientY] = points[index];
      assert.ok(Math.abs(clientX - x) <= 1 && Math.abs(clientY - y) <= 1, `${phase}: click ${x},${y} landed at ${clientX},${clientY}`);
    }
    emit({ phase, screen: [screenWidth, screenHeight], requested: [width, height], actual, bounds, crop, jpegPixels: matching.at(-1).pixels, freshFrames: matching.length, clicks: points.length, tabs: 1 });
  }
  viewer = await connect();
  for (const [name, width, height] of [["initial", 620, 632], ["maximize", 1280, 680], ["wider-panel", 800, 632],
    ["agent-size", 1440, 900], ["retina-full", 1720, 1000], ["restore", 620, 632]]) {
    phase = name;
    await resize(width, height);
  }
  phase = "viewer-input";
  viewer.socket.send(JSON.stringify({ type: "mouse", event: "click", x: 50, y: 30, button: "left" }));
  await until(async () => await evaluate("window.clicks") === 1, "synthetic click");
  viewer.socket.close();
  await until(() => viewer.socket.readyState === WebSocket.CLOSED, "first viewer closed");
  phase = "idle-reconnect";
  await setPageLifecycle(cdpPort, "frozen");
  viewer = await connect();
  await resize(620, 632);
  phase = "maximize-after-idle";
  await resize(1280, 680);
  assert.deepEqual(failures, []);
  emit({ success: true, directory, syntheticClick: true, sameTab: true });
} catch (error) {
  emit({ success: false, phase, error: error.message, directory });
  process.exitCode = 1;
} finally {
  viewer?.socket.close();
  if (router) await shutdownProjectBrowserRouter(router, { idle, stopKeeper, timeoutMs: 5_000 });
  else stopKeeper?.();
  connection?.close();
  page.closeAllConnections();
  page.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  clearTimeout(hardDeadline);
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
