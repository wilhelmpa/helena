import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGatewayAgentRunner } from "../gateway-agent.mjs";

describe("createGatewayAgentRunner", () => {
  it("uses one persistent connection and observes the accepted run without rerunning it", async () => {
    const requests = [];
    let starts = 0;
    let stops = 0;
    const runner = createGatewayAgentRunner(
      {
        openClawGatewayUrl: "ws://127.0.0.1:18789/",
        openClawGatewayPassword: "x".repeat(32),
        inboxAgentId: "test-classifier",
      },
      {
        createClient(options) {
          return {
            start() {
              starts += 1;
              queueMicrotask(() => options.onHelloOk({}));
            },
            stop() {
              stops += 1;
            },
            async request(method, params, requestOptions) {
              requests.push({ method, params, requestOptions });
              if (method === "agent") return { runId: "run-1" };
              if (requests.filter((item) => item.method === "agent.wait").length === 1) {
                return { status: "pending" };
              }
              return {
                status: "ok",
                terminalReply: { disposition: "visible", text: '{"summary":"Done"}' },
              };
            },
          };
        },
      },
    );

    const text = await runner.run({
      prompt: "Triage this",
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174001", // gitleaks:allow -- inert test fixture
    });
    assert.equal(text, '{"summary":"Done"}');
    assert.equal(starts, 1);
    assert.equal(requests.filter((item) => item.method === "agent").length, 1);
    assert.equal(requests.filter((item) => item.method === "agent.wait").length, 2);
    assert.deepEqual(requests[0].params, {
      message: "Triage this",
      agentId: "test-classifier",
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      thinking: "low",
      deliver: false,
      disableMessageTool: true,
      timeout: 90,
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174001", // gitleaks:allow -- inert test fixture
    });
    runner.stop();
    assert.equal(stops, 1);
  });

  it("does not turn a terminal error into a second agent run", async () => {
    let agentCalls = 0;
    const runner = createGatewayAgentRunner(
      {
        openClawGatewayUrl: "ws://127.0.0.1:18789/",
        openClawGatewayPassword: "x".repeat(32),
        inboxAgentId: "test-classifier",
      },
      {
        createClient(options) {
          return {
            start: () => queueMicrotask(() => options.onHelloOk({})),
            stop() {},
            async request(method) {
              if (method === "agent") {
                agentCalls += 1;
                return { runId: "run-1" };
              }
              return { status: "error", error: "failed" };
            },
          };
        },
      },
    );
    await assert.rejects(
      runner.run({ prompt: "Triage", sessionId: "session", idempotencyKey: "key" }),
      /triage run failed/,
    );
    assert.equal(agentCalls, 1);
    runner.stop();
  });
});
