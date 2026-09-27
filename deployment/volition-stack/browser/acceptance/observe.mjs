// Root-only observer for an existing synthetic project tab. No navigation, input or new tabs.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ROOT = "/var/lib/volition/project-browser/projects";

export function fixtureUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.username || url.password || url.search || url.hash)
    throw new Error("Invalid fixture URL");
  if (!url.pathname.endsWith("/fixture.html")) throw new Error("Expected fixture.html");
  return url.href;
}

export function selectFixture(targets, fixture) {
  const pages = targets.filter((target) => target.type === "page");
  if (pages.length !== 1 || pages[0].url !== fixture ||
      typeof pages[0].id !== "string" || !ID.test(pages[0].id))
    throw new Error("The project must contain exactly one page: the synthetic fixture");
  return pages[0];
}

function sameDocument(before, after) {
  for (const report of [before, after]) {
    if (!report || !Number.isFinite(report.timeOrigin) || report.timeOrigin <= 0 ||
        !Number.isFinite(report.observedAt) || report.observedAt <= report.timeOrigin ||
        !Number.isSafeInteger(report.counter) || report.counter < 0 ||
        !Number.isSafeInteger(report.heartbeat) || report.heartbeat < 0)
      throw new Error("Invalid proof report");
  }
  if (
    before.schema !== 1 || after.schema !== 1 ||
    typeof before.slug !== "string" || !SLUG.test(before.slug) ||
    before.slug !== after.slug || before.fixture !== after.fixture ||
    typeof before.targetId !== "string" || !ID.test(before.targetId) || before.targetId !== after.targetId ||
    before.pageCount !== 1 || after.pageCount !== 1 ||
    !UUID.test(before.documentId) || before.documentId !== after.documentId ||
    before.timeOrigin !== after.timeOrigin ||
    after.observedAt <= before.observedAt || after.heartbeat < before.heartbeat
  ) throw new Error("Project, target or document changed; continuity is not proved");
  fixtureUrl(before.fixture);
  return {
    sameProject: true, sameTarget: true, sameDocument: true, pageCount: 1,
    elapsedMs: after.observedAt - before.observedAt,
    counterBefore: before.counter, counterAfter: after.counter,
    // A low timer delta alone does not prove lifecycle freezing; background throttling exists.
    heartbeatDelta: after.heartbeat - before.heartbeat,
  };
}

export function compare(before, after) {
  const evidence = sameDocument(before, after);
  if (after.counter !== before.counter + 1) throw new Error("Reconnect input is not proved");
  return { ...evidence, inputCounterAdvanced: true };
}

function fixtureOutcome(before, after) {
  const evidence = sameDocument(before, after);
  for (const report of [before, after]) {
    if (typeof report.nameMatches !== "boolean" || typeof report.accepted !== "boolean")
      throw new Error("Missing fixture outcome");
  }
  if (before.counter !== after.counter) throw new Error("Unexpected counter input");
  return evidence;
}

export function compareTask(before, after) {
  const evidence = fixtureOutcome(before, after);
  if (before.nameMatches || before.accepted || !after.nameMatches || !after.accepted)
    throw new Error("Fresh fixture success is not proved");
  return { ...evidence, fixtureSuccessObserved: true };
}

export function compareUnchanged(before, after) {
  const evidence = fixtureOutcome(before, after);
  if (before.nameMatches !== after.nameMatches || before.accepted !== after.accepted)
    throw new Error("Fixture outcome changed");
  // These fixed fields cannot establish that no action was attempted; inspect native steps too.
  return { ...evidence, fixtureOutcomeUnchanged: true };
}

async function trustedScript() {
  if (process.getuid?.() !== 0) throw new Error("Root observer required");
  let current = fileURLToPath(import.meta.url);
  for (;;) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022))
      throw new Error("Stage the reviewed script in a root-owned protected directory");
    const parent = path.dirname(current);
    if (current === parent) break;
    current = parent;
  }
}

async function cdp(url, expression) {
  const socket = new WebSocket(url);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error("CDP observation failed or timed out"));
      timer = setTimeout(fail, 8000);
      socket.addEventListener("error", fail);
      socket.addEventListener("close", fail);
      socket.addEventListener("open", () => socket.send(JSON.stringify({
        id: 1, method: "Runtime.evaluate",
        params: { expression, returnByValue: true, timeout: 5000 },
      })));
      socket.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string" || event.data.length > 64 * 1024) return fail();
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) return fail();
          resolve(message.result?.result?.value);
        } catch { fail(); }
      });
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

async function snapshot(slug, rawFixture) {
  if (!SLUG.test(slug)) throw new Error("Invalid project slug");
  const fixture = fixtureUrl(rawFixture);
  const directory = path.join(ROOT, slug);
  const statePath = path.join(directory, "runtime.json");
  const directoryInfo = await lstat(directory);
  const info = await lstat(statePath);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) ||
      !info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== directoryInfo.uid ||
      info.size > 16 * 1024)
    throw new Error("Invalid private project browser state");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (state.slug !== slug || state.schemaVersion !== 1 || !Number.isInteger(state.cdpPort) ||
      state.cdpPort < 1024 || state.cdpPort > 65535) throw new Error("Invalid project browser port");
  const response = await fetch(`http://127.0.0.1:${state.cdpPort}/json/list`, {
    signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!response.ok) throw new Error("Project browser unavailable");
  const body = await response.text();
  if (body.length > 256 * 1024) throw new Error("Target list too large");
  const targets = JSON.parse(body);
  const target = selectFixture(targets, fixture);
  const websocket = new URL(target.webSocketDebuggerUrl);
  if (websocket.protocol !== "ws:" || websocket.hostname !== "127.0.0.1" ||
      websocket.port !== String(state.cdpPort) || websocket.username || websocket.password ||
      websocket.search || websocket.hash || websocket.pathname !== `/devtools/page/${target.id}`)
    throw new Error("Unexpected CDP endpoint");
  const observed = await cdp(websocket.href, `(() => {
    if (location.href !== ${JSON.stringify(fixture)} ||
        document.body?.dataset.helenaProof !== 'browser-acceptance-v1') return null;
    return {
      documentId: document.body.dataset.proofDocument,
      timeOrigin: performance.timeOrigin,
      counter: Number(document.querySelector('#count')?.textContent),
      heartbeat: Number(document.querySelector('#tick')?.textContent),
      nameMatches: document.querySelector('#name')?.value === 'Ada Proof',
      accepted: document.querySelector('#result')?.textContent === 'Fixture accepted Ada Proof'
    };
  })()`);
  if (!observed || !UUID.test(observed.documentId) || !Number.isFinite(observed.timeOrigin) ||
      !Number.isSafeInteger(observed.counter) || observed.counter < 0 ||
      !Number.isSafeInteger(observed.heartbeat) || observed.heartbeat < 0)
    throw new Error("Synthetic fixture changed or was unavailable");
  // Recheck that no tab was created or navigation occurred during the observation.
  const again = await fetch(`http://127.0.0.1:${state.cdpPort}/json/list`, {
    signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!again.ok || selectFixture(await again.json(), fixture).id !== target.id)
    throw new Error("Target changed during observation");
  return { schema: 1, slug, fixture, targetId: target.id, pageCount: 1, observedAt: Date.now(), ...observed };
}

async function main() {
  await trustedScript();
  const [mode, first, second, ...rest] = process.argv.slice(2);
  if (!first || !second || rest.length) throw new Error("Expected operation and two arguments");
  const comparator = new Map([
    ["compare", compare], ["compare-task", compareTask], ["compare-unchanged", compareUnchanged],
  ]).get(mode);
  if (mode !== "snapshot" && !comparator) throw new Error("Unknown proof operation");
  const result = mode === "snapshot" ? await snapshot(first, second)
    : comparator(JSON.parse(await readFile(first, "utf8")), JSON.parse(await readFile(second, "utf8")));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Browser proof observer refused or failed. Check the runbook preconditions; no pass was recorded.");
    process.exitCode = 1;
  });
}
