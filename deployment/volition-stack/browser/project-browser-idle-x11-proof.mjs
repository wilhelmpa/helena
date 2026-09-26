import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { BrowserLink, listTabs, openBrowser, releasePageVisibility } from "./project-browser-control.mjs";
import { setPageLifecycle } from "./project-browser-idle.mjs";

// Explicit opt-in native proof: private display, temporary profile, synthetic loopback pages only.
const directory = await mkdtemp(path.join(os.tmpdir(), "helena-idle-proof-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<title>Helena synthetic idle proof</title><body><script>let n=0;setInterval(()=>{document.body.style.background=++n%2?'steelblue':'seagreen';document.body.textContent='Synthetic frame '+n},60)</script>");
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
    "--remote-debugging-address=127.0.0.1", "--ozone-platform=x11", "--no-first-run",
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
  const reconnect = async () => {
    connection.close();
    await setPageLifecycle(port, "active");
    connection = await openBrowser(port);
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
  phase = "single-tab-idle-reconnect";
  const [original] = await tabs();
  await sleep(200);
  assert.equal(await visibility(original.targetId), "visible");
  assert.equal(await setPageLifecycle(port, "frozen"), 1);
  await reconnect();
  assert.equal((await tabs()).length, 1);
  assert.equal(await visibility(original.targetId), "visible");
  emit({ phase, frames: await liveFrames(original.targetId), tabs: 1 });

  phase = "two-tabs-idle-reconnect";
  const second = await connection.send("Target.createTarget", { url: `${url}second` });
  await connection.send("Target.activateTarget", { targetId: second.targetId });
  await sleep(200);
  assert.equal(await visibility(original.targetId), "visible");
  assert.equal(await visibility(second.targetId), "visible");
  assert.equal((await listTabs(port)).find((tab) => tab.active).id, second.targetId);
  assert.equal(await visibility(original.targetId), "hidden");
  assert.equal(await setPageLifecycle(port, "frozen"), 2);
  await reconnect();
  assert.equal((await tabs()).length, 2);
  assert.equal(await visibility(original.targetId), "hidden");
  assert.equal(await visibility(second.targetId), "visible");
  emit({ phase, frames: await liveFrames(second.targetId), tabs: 2 });

  phase = "existing-background-tab-switch";
  await connection.send("Target.activateTarget", { targetId: original.targetId });
  await sleep(150);
  assert.equal(await visibility(original.targetId), "visible");
  assert.equal((await listTabs(port)).find((tab) => tab.active).id, original.targetId);
  assert.equal(await visibility(second.targetId), "hidden");
  emit({ phase, frames: await liveFrames(original.targetId), tabs: (await tabs()).length });

  phase = "release-and-refreeze";
  await releasePageVisibility(port);
  assert.equal(await setPageLifecycle(port, "frozen"), 2);
  const sample = await attach(original.targetId);
  const tick = async () => (await connection.send("Runtime.evaluate", { expression: "window.proofN", returnByValue: true }, sample)).result.value;
  const pausedAt = await tick();
  await sleep(250);
  assert.equal(await tick(), pausedAt);
  emit({ phase, timerStopped: true, tabs: (await tabs()).length });
  await connection.send("Page.setWebLifecycleState", { state: "active" }, sample);
  const temporaryLink = new BrowserLink(port);
  await temporaryLink.capture(original.targetId);
  assert.equal(await visibility(original.targetId), "visible");
  temporaryLink.close();
  await sleep(100);
  assert.equal(await visibility(original.targetId), "hidden");
  await connection.send("Target.detachFromTarget", { sessionId: sample });
  emit({ phase: "connection-close-releases-lease", hidden: true });
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
