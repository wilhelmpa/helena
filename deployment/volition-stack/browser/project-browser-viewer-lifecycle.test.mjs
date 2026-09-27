import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { ScreencastStream } from "./project-browser-screencast.mjs";

function fixture() {
  const stream = new ScreencastStream(42001, null, () => {});
  // CDP deliberately never progresses: hiding must not wait for it.
  stream.resize = () => {};
  stream.modeRun = new Promise(() => {});
  const viewer = () => {
    const socket = new EventEmitter();
    socket.send = () => {};
    socket.close = () => socket.emit("close");
    stream.add(socket);
    const entry = [...stream.viewers].at(-1);
    entry.viewport = { width: 800, height: 600, dpr: 1, video: true };
    entry.tierIndex = 0;
    return entry;
  };
  let stopped = 0;
  const encoding = () => {
    stream.videoArea = { x: 0, y: 0, width: 800, height: 600 };
    stream.tiers.set("high", { encoder: { stop: () => stopped++ }, keyframeBytes: () => 0, kbps: () => 0 });
  };
  return { stream, viewer, encoding, stops: () => stopped };
}

test("a fresh viewer must declare visibility before it can request encoding", () => {
  const f = fixture();const viewer = f.viewer();
  assert.equal(viewer.hidden, true);
  assert.deepEqual(f.stream.shownViewers(), []);
  f.stream.welcome = () => {};f.stream.reassignTiers = () => {};
  f.stream.receive(viewer, JSON.stringify({ type: "hidden", hidden: false }));
  assert.deepEqual(f.stream.shownViewers(), [viewer]);
});

test("last visible viewer hiding stops its encoder despite pending CDP mode work", () => {
  const f = fixture();const viewer = f.viewer();viewer.hidden = false;f.encoding();
  f.stream.setViewerHidden(viewer, true);
  assert.equal(f.stops(), 1);assert.equal(f.stream.tiers.size, 0);
});

test("one hidden viewer does not stop a second shown viewer; final close does", () => {
  const f = fixture();const a = f.viewer();const b = f.viewer();a.hidden = false;b.hidden = false;f.encoding();
  f.stream.setViewerHidden(a, true);
  assert.equal(f.stops(), 0);assert.equal(f.stream.tiers.size, 1);
  b.socket.emit("close");
  assert.equal(f.stops(), 1);assert.equal(f.stream.tiers.size, 0);
  assert.equal(f.stream.ended, false); // hidden legacy subscriber can resume
});

test("visible again starts an encoder, and the last subscriber disconnect stops it", () => {
  const f = fixture();const viewer = f.viewer();viewer.hidden = false;f.encoding();
  f.stream.setViewerHidden(viewer, true);
  f.stream.welcome = () => {};f.stream.startTierEncoder = (tier) => {
    f.stream.tiers.set(tier.name, { encoder: { stop: () => {} }, keyframeBytes: () => 0, kbps: () => 0 });
  };
  f.stream.setViewerHidden(viewer, false);
  assert.equal(f.stream.tiers.size, 1);
  viewer.socket.emit("close");
  assert.equal(f.stream.ended, true);assert.equal(f.stream.tiers.size, 0);
});
