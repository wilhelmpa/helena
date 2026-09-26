import assert from "node:assert/strict";
import { test } from "node:test";
import { joinScreencast, ScreencastStream, setControlState, setViewportAuthority, viewportAuthority } from "./project-browser-screencast.mjs";

function connectedStream(port) {
  let stream;
  const start = ScreencastStream.prototype.start;
  ScreencastStream.prototype.start = function () { stream = this; };
  try {
    joinScreencast(port, null, { send() {}, on() {}, close() {} });
  } finally {
    ScreencastStream.prototype.start = start;
  }
  let resizes = 0;
  stream.resize = () => { resizes++; };
  return { stream, resizes: () => resizes };
}

for (const [index, holder] of [{ kind: "owner" }, null].entries()) {
  test(`authoritative ${holder?.kind ?? "free"} control immediately releases the heuristic resize hold`, () => {
    const port = 42001 + index;
    const { stream, resizes } = connectedStream(port);
    try {
      stream.noteAgentActivity();
      assert.ok(stream.agentActiveAt > 0);
      assert.equal(resizes(), 1);
      setControlState(port, { holder, since: null });
      assert.equal(stream.agentActiveAt, 0);
      assert.equal(resizes(), 2);
      stream.noteNavigation();
      stream.noteAgentActivity();
      assert.equal(stream.agentActiveAt, 0);
      assert.equal(resizes(), 2);
    } finally { stream.end(); }
  });
}

test("unknown control retains the existing activity heuristic", () => {
  const { stream, resizes } = connectedStream(42003);
  try {
    stream.noteNavigation();
    assert.ok(stream.agentActiveAt > 0);
    assert.equal(resizes(), 1);
  } finally { stream.end(); }
});

test("agent control and its fixed working viewport remain authoritative", () => {
  const port = 42004;
  const { stream, resizes } = connectedStream(port);
  try {
    setControlState(port, { holder: { kind: "agent", agentId: 1 }, since: 1 });
    setViewportAuthority(port, "fixed", { width: 1440, height: 900 }, "Synthetic agent");
    stream.noteAgentActivity();
    const activeAt = stream.agentActiveAt;
    assert.ok(activeAt > 0);
    assert.equal(resizes(), 2);
    setControlState(port, { holder: { kind: "agent", agentId: 1 }, since: 1 });
    assert.equal(stream.agentActiveAt, activeAt);
    assert.equal(resizes(), 2);
    assert.deepEqual(viewportAuthority(port), {
      mode: "fixed", width: 1440, height: 900, holder: "Synthetic agent",
    });
    assert.deepEqual(stream.sizingViewport(), { width: 1440, height: 900, dpr: 1 });
  } finally {
    setViewportAuthority(port, "follow");
    stream.end();
  }
});
