import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { BrowserLink, openBrowser, releasePageVisibility, setLiveViewport, setWindowCalibrationAllowed, windowChrome } from "./project-browser-control.mjs";

// Explicit opt-in native proof: private display, temporary profile, synthetic loopback pages only.
const directory = await mkdtemp(path.join(os.tmpdir(), "helena-crop-proof-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<title>Helena synthetic idle proof</title><body><script>let n=0;window.baseTimer=setInterval(()=>{document.body.style.background=++n%2?'steelblue':'seagreen';document.body.textContent='Synthetic frame '+n},60)</script>");
});
let xserver;
let chromium;
let connection;
let port;
let phase = "setup";
const emit = (value) => console.log(JSON.stringify(value));
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  xserver = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
    { stdio: ["ignore", "ignore", "ignore", "pipe"] });
  const display = await Promise.race([
    new Promise((resolve, reject) => {
      xserver.once("error", reject);
      xserver.stdio[3].once("data", (chunk) => resolve(chunk.toString().trim()));
    }),
    sleep(5_000).then(() => { throw new Error("Display timeout"); }),
  ]);
  assert.match(display, /^\d+$/);
  chromium = spawn("chromium", [
    `--user-data-dir=${path.join(directory, "profile")}`, "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1", "--ozone-platform=x11", "--force-device-scale-factor=2", "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-proxy-server",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost", "--disable-features=MediaRouter,OptimizationHints", url,
  ], { env: { PATH: process.env.PATH, HOME: directory, DISPLAY: `:${display}` }, stdio: "ignore" });
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(chromium.exitCode, null);
    try { port = Number((await readFile(path.join(directory, "profile", "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch {}
    if (port) break;
    await sleep(100);
  }
  assert.ok(port);
  connection = await openBrowser(port);
  const tabs = async () => (await connection.send("Target.getTargets")).targetInfos.filter((target) => target.type === "page");
  const attach = async (targetId) => (await connection.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  const visibility = async (targetId) => {
    const session = await attach(targetId);
    try {
      return (await connection.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, session)).result.value;
    } finally { await connection.send("Target.detachFromTarget", { sessionId: session }); }
  };
  const liveFrames = async (targetId) => {
    const session = await attach(targetId);
    let frames = 0;
    connection.onEvent = (event) => {
      if (event.sessionId !== session || event.method !== "Page.screencastFrame") return;
      frames++;
      void connection.send("Page.screencastFrameAck", { sessionId: event.params.sessionId }, session);
    };
    await connection.send("Page.enable", {}, session);
    await connection.send("Runtime.evaluate", { expression: "window.proofN=0;window.proofTimer=setInterval(()=>{document.body.style.background=++window.proofN%2?'steelblue':'seagreen'},60)" }, session);
    await connection.send("Page.startScreencast", { format: "jpeg", quality: 40, maxWidth: 400, maxHeight: 300 }, session);
    await sleep(450);
    emit({ phase: "frames-read", frames, visibility: await visibility(targetId), ticks: (await connection.send("Runtime.evaluate", { expression: "window.proofN", returnByValue: true }, session)).result.value });
    await connection.send("Page.stopScreencast", {}, session);
    await connection.send("Target.detachFromTarget", { sessionId: session });
    assert.ok(frames >= 2, "expected fresh frames after router reconnect");
    return frames;
  };
  phase = "foreign-emulation";
  const [original] = await tabs();
  await sleep(250);
  const session = await attach(original.targetId);
  const geometry = async () => (await connection.send("Runtime.evaluate", {
    expression: "[document.visibilityState,screen.width,screen.height,outerWidth,outerHeight,innerWidth,innerHeight,devicePixelRatio]", returnByValue: true,
  }, session)).result.value;
  const { windowId } = await connection.send("Browser.getWindowForTarget", { targetId: original.targetId });
  await connection.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: 800, height: 500 } });
  await sleep(200);
  const foreign = new BrowserLink(port);
  await foreign.pin(original.targetId, { width: 800, height: 500, ratio: 1 });
  setWindowCalibrationAllowed(port, true);
  const emulated = await geometry();
  await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
  assert.equal(windowChrome(port), null);
  emit({ phase, emulated, crop: windowChrome(port), actual: await geometry() });
  foreign.close();
  await sleep(100);
  phase = "foreign-detach-recalibration";
  await setLiveViewport(port, { width: 420, height: 300, ratio: 1, pin1: true });
  const crop = windowChrome(port);
  assert.ok(crop && crop.height > 0 && crop.scale === 2);
  const actual = await geometry();
  assert.deepEqual(actual.slice(5), [420, 300, 1]);
  emit({ phase, crop, actual, frames: await liveFrames(original.targetId) });
  const inputSetup = await connection.send("Runtime.evaluate", { expression: "(()=>{clearInterval(window.baseTimer);clearInterval(window.proofTimer);window.proofClicks=0;const button=document.createElement('button');button.style='position:fixed;left:10px;top:10px;width:100px;height:40px';button.onclick=()=>window.proofClicks++;document.body.append(button);return true})()", returnByValue: true }, session);
  assert.equal(inputSetup.result?.value, true, inputSetup.exceptionDetails?.text);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await connection.send("Input.dispatchMouseEvent", { type, x: 50, y: 30, button: "left", clickCount: 1 }, session);
  }
  assert.equal((await connection.send("Runtime.evaluate", { expression: "window.proofClicks", returnByValue: true }, session)).result.value, 1);
  phase = "desktop-release";
  await setLiveViewport(port, null);
  const desktop = await geometry();
  assert.equal(desktop[3], desktop[1]);
  assert.equal(desktop[4], desktop[2]);
  assert.equal(desktop[7], 2);
  assert.equal((await tabs()).length, 1);
  emit({ phase, crop: windowChrome(port), actual: desktop, inputClick: true, tabs: 1 });
  emit({ success: true, directory });
} catch (error) {
  emit({ success: false, phase, error: error.message, directory });
  process.exitCode = 1;
} finally {
  if (port) await releasePageVisibility(port).catch(() => {});
  connection?.close();
  server.close();
  for (const child of [chromium, xserver]) {
    if (!child || child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
