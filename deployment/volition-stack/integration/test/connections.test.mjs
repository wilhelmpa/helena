import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConnectionsService, ConnectionsValidationError } from "../connections.mjs";

function fakeClient(calls) {
  return {
    start() {
      queueMicrotask(() => this.options.onHelloOk());
    },
    stop() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === "channels.status") {
        return {
          channelLabels: { whatsapp: "WhatsApp" },
          channelAccounts: { whatsapp: [{ accountId: "personal", configured: true, running: true, connected: true, lastConnectedAt: 1_700_000_000_000 }] },
        };
      }
      return { ok: true };
    },
  };
}

describe("connections service", () => {
  it("returns redacted MCP, channel and service status", async () => {
    const calls = [];
    const service = createConnectionsService(
      { openClawGatewayUrl: "ws://127.0.0.1:18789", openClawGatewayPassword: "secret", openClawBin: "/opt/openclaw", openClawRoot: "/home/owner/.openclaw", nextcloudInternalUrl: "http://127.0.0.1:8092" },
      {
        createClient(options) { const client = fakeClient(calls); client.options = options; return client; },
        fetch: async () => ({ status: 200 }),
        execute: async (_file, args) => ({ stdout: JSON.stringify(args[1] === "status" ? { servers: [{ name: "google-private", configured: true, enabled: true, ok: true }] } : { tools: [{ name: "gmail_search" }] }) }),
        artifactSync: {
          status: async () => ({
            running: false,
            projects: {
              demo: { lastSuccessAt: "2026-09-21T12:00:00.000Z", lastDryRunAt: null, lastError: null, artifactCount: 3 },
            },
          }),
        },
      },
    );
    const result = await service.snapshot();
    assert.ok(result.items.some((item) => item.id === "mcp:google-private" && item.status === "configured"));
    assert.ok(result.items.some((item) => item.id === "channel:whatsapp:personal"));
    assert.ok(result.items.some((item) => item.id === "service:nextcloud"));
    assert.ok(result.items.some((item) => item.id === "service:artifact-sync" && item.status === "connected"));
    assert.ok(!JSON.stringify(result).includes("hidden"));
  });

  it("only reconnects a validated native channel", async () => {
    const calls = [];
    const service = createConnectionsService(
      { openClawGatewayUrl: "ws://127.0.0.1:18789", openClawGatewayPassword: "secret", openClawBin: "/opt/openclaw", openClawRoot: "/home/owner/.openclaw", nextcloudInternalUrl: "http://127.0.0.1:8092" },
      { createClient(options) { const client = fakeClient(calls); client.options = options; return client; }, fetch: async () => ({ status: 200 }), execute: async (_file, args) => ({ stdout: JSON.stringify(args[1] === "status" ? { servers: [] } : {}) }) },
    );
    await service.action({ id: "channel:whatsapp:personal", action: "reconnect" });
    assert.ok(calls.some((call) => call.method === "channels.stop"));
    assert.ok(calls.some((call) => call.method === "channels.start"));
    await assert.rejects(() => service.action({ id: "service:nextcloud", action: "reconnect" }), ConnectionsValidationError);
  });

  it("accepts the browser profile bridge when the backend has no durable identity", async () => {
    const calls = [];
    const service = createConnectionsService(
      { openClawGatewayUrl: "ws://127.0.0.1:18789", openClawGatewayPassword: "secret", openClawBin: "/opt/openclaw", openClawRoot: "/home/owner/.openclaw", nextcloudInternalUrl: "http://127.0.0.1:8092" },
      {
        createClient(options) {
          const client = fakeClient(calls);
          client.options = options;
          client.request = async (method, params) => {
            calls.push({ method, params });
            return { status: "no_durable_identity" };
          };
          return client;
        },
      },
    );
    await service.setTheme("dark");
    assert.deepEqual(calls.at(-1), {
      method: "users.prefs.set",
      params: { entries: { "ui.themeMode": "dark" } },
    });
  });
});
