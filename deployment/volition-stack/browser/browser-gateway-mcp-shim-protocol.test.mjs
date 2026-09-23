import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { callGateway, gatewayRequestLine } from "./browser-gateway-mcp-shim-protocol.mjs";

let root;
let server;

afterEach(async () => {
  server?.close();
  server = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function socketPath() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-gateway-shim-"));
  return path.join(root, "gateway.sock");
}

// Stands up a plain net server that speaks exactly the frozen wire protocol (one JSON line
// in, one JSON line out) -- no real gateway needed, per the task.
function startFakeGateway(target, onLine) {
  return new Promise((resolve) => {
    server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const request = JSON.parse(buffer.slice(0, newline));
        const response = onLine(request);
        if (response !== null) socket.end(`${JSON.stringify(response)}\n`);
      });
    });
    server.listen(target, () => resolve());
  });
}

describe("gatewayRequestLine: the request framing", () => {
  it("sends tool, args and the agent key, with runId/messageId omitted when unset", () => {
    const line = gatewayRequestLine("browser_status", { project: "verve" }, { ITSAPLAN_API_KEY: "k" });
    assert.equal(line.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(line), { tool: "browser_status", args: { project: "verve" }, agentKey: "k" });
  });

  it("carries runId and messageId as numbers when the environment has them", () => {
    const line = gatewayRequestLine(
      "browser_click",
      { ref: "e3" },
      { ITSAPLAN_API_KEY: "k", ITSAPLAN_RUN_ID: "42", ITSAPLAN_MESSAGE_ID: "7" },
    );
    assert.deepEqual(JSON.parse(line), {
      tool: "browser_click",
      args: { ref: "e3" },
      agentKey: "k",
      runId: 42,
      messageId: 7,
    });
  });

  it("defaults args to {} and the agent key to an empty string", () => {
    const line = gatewayRequestLine("browser_status", undefined, {});
    assert.deepEqual(JSON.parse(line), { tool: "browser_status", args: {}, agentKey: "" });
  });
});

describe("callGateway: the response mapping", () => {
  it("maps a successful answer to a non-error text result", async () => {
    const target = await socketPath();
    let received;
    await startFakeGateway(target, (request) => {
      received = request;
      return { ok: true, content: "Steuert: niemand" };
    });

    const result = await callGateway(
      "browser_status",
      { project: "verve" },
      { socketPath: target, env: { ITSAPLAN_API_KEY: "the-agent-key" } },
    );

    assert.deepEqual(received, { tool: "browser_status", args: { project: "verve" }, agentKey: "the-agent-key" });
    assert.deepEqual(result, { content: [{ type: "text", text: "Steuert: niemand" }], isError: false });
  });

  it("maps a refusal to an error text result", async () => {
    const target = await socketPath();
    await startFakeGateway(target, () => ({ ok: false, error: "another agent holds the lock" }));

    const result = await callGateway("browser_acquire", {}, { socketPath: target, env: {} });

    assert.deepEqual(result, {
      content: [{ type: "text", text: "another agent holds the lock" }],
      isError: true,
    });
  });

  it("reports a connection error gracefully instead of throwing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-gateway-shim-"));
    const missing = path.join(root, "does-not-exist.sock");

    const result = await callGateway("browser_status", {}, { socketPath: missing, env: {} });

    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /Cannot reach the browser gateway/);
  });

  it("reports an unreadable answer as an error instead of throwing", async () => {
    const target = await socketPath();
    await new Promise((resolve) => {
      server = net.createServer((socket) => {
        socket.on("data", () => socket.end("not json\n"));
      });
      server.listen(target, resolve);
    });

    const result = await callGateway("browser_status", {}, { socketPath: target, env: {} });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unreadable/);
  });
});
