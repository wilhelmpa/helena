import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createProvisioningServer } from "../server.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- inert test fixture
const CONNECTIONS_TOKEN = "connections-owner-token-0123456789abcdef";
const INBOX_TOKEN = "inbox-integration-token-0123456789abcdef";
let server;
let origin;

beforeEach(async () => {
  server = createProvisioningServer(
    {
      token: TOKEN,
      inboxAccounts: ["owner@example.com"],
      inboxIntegrationToken: INBOX_TOKEN,
      connectionsIntegrationToken: CONNECTIONS_TOKEN,
      connectionsEnabled: true,
    },
    {
      provisioner: { provision: async () => ({}) },
      triage: {},
      connections: {
        snapshot: async () => ({
          checkedAt: "2026-09-21T00:00:00.000Z",
          items: [],
        }),
        action: async () => ({
          checkedAt: "2026-09-21T00:00:00.000Z",
          items: [],
        }),
      },
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => new Promise((resolve) => server.close(resolve)));

function request(path, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CONNECTIONS_TOKEN}`,
      ...(init.headers || {}),
    },
  });
}

it("refuses the inbox worker credential on owner connections routes", async () => {
  const response = await fetch(`${origin}/api/connections`, {
    headers: { Authorization: `Bearer ${INBOX_TOKEN}` },
  });
  assert.equal(response.status, 401);
});

describe("communications routes", () => {
  it("protects connection inventory with the integration bearer", async () => {
    assert.equal((await fetch(`${origin}/api/connections`)).status, 401);
    const response = await request("/api/connections");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      checkedAt: "2026-09-21T00:00:00.000Z",
      items: [],
    });
  });
});
