import { GatewayClient } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

const CONNECT_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 100_000;
const WAIT_SLICE_MS = 30_000;

function nonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is missing`);
  return value;
}

export function createGatewayAgentRunner(config, options = {}) {
  const createClient = options.createClient ?? ((clientOptions) => new GatewayClient(clientOptions));
  const now = options.now ?? Date.now;
  let client;
  let connected = false;
  const waiters = new Set();

  function settleWaiters(error) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
    waiters.clear();
  }

  function ensureClient() {
    if (client) return;
    client = createClient({
      url: config.openClawGatewayUrl,
      password: config.openClawGatewayPassword,
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      clientName: "gateway-client",
      clientDisplayName: "Volition inbox integration",
      mode: "backend",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      onHelloOk: () => {
        connected = true;
        settleWaiters();
      },
      onConnectError: () => {
        connected = false;
        settleWaiters(new Error("The OpenClaw Gateway connection failed"));
      },
      onClose: () => {
        connected = false;
      },
    });
    client.start();
  }

  async function waitUntilConnected() {
    ensureClient();
    if (connected) return;
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("The OpenClaw Gateway connection timed out"));
        }, CONNECT_TIMEOUT_MS),
      };
      waiters.add(waiter);
    });
  }

  return {
    async run({ prompt, sessionId, idempotencyKey }) {
      await waitUntilConnected();
      const accepted = await client.request(
        "agent",
        {
          message: nonEmptyString(prompt, "prompt"),
          agentId: nonEmptyString(config.inboxAgentId, "inboxAgentId"),
          sessionId: nonEmptyString(sessionId, "sessionId"),
          thinking: "low",
          deliver: false,
          disableMessageTool: true,
          timeout: 90,
          idempotencyKey: nonEmptyString(idempotencyKey, "idempotencyKey"),
        },
        { timeoutMs: 15_000 },
      );
      const runId = nonEmptyString(accepted?.runId, "runId");
      const deadline = now() + RUN_TIMEOUT_MS;
      for (;;) {
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error("The inbox triage run timed out");
        const timeoutMs = Math.min(WAIT_SLICE_MS, remaining);
        const result = await client.request(
          "agent.wait",
          { runId, timeoutMs },
          { timeoutMs: timeoutMs + 2_000 },
        );
        if (result?.status === "pending") continue;
        if (
          result?.status === "timeout" &&
          result?.endedAt === undefined &&
          !result?.stopReason &&
          !result?.livenessState
        ) {
          continue;
        }
        if (
          result?.status === "ok" &&
          result?.terminalReply?.disposition === "visible" &&
          typeof result.terminalReply.text === "string"
        ) {
          return result.terminalReply.text;
        }
        throw new Error("The inbox triage run failed");
      }
    },
    stop() {
      settleWaiters(new Error("The OpenClaw Gateway client stopped"));
      client?.stop();
      client = undefined;
      connected = false;
    },
  };
}
