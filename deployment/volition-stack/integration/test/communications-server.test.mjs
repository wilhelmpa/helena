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
      inboxPushToken: "push-token-0123456789abcdef0123456789",
      inboxTriageTransport: "cli",
      mastraInboxToken: "mastra-inbox-token-0123456789abcdef0123456789",
      connectionsEnabled: true,
      mailEnabled: true,
    },
    {
      provisioner: { provision: async () => ({}) },
      inbox: {},
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
      mail: {
        accountsStatus: async () => ({
          accounts: [
            {
              account: "owner@example.com",
              status: "connected",
              lastCheckedAt: "2026-09-21T00:00:00.000Z",
              lastError: null,
            },
          ],
        }),
        search: async () => ({ threads: [] }),
        attachment: async () => ({
          bytes: Buffer.from("document"),
          filename: "report.pdf",
          contentType: "application/pdf",
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

it("refuses the inbox worker credential on owner mail and connections routes", async () => {
  const response = await fetch(`${origin}/api/mail/accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INBOX_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: "{}",
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

  it("returns mail attachments as bounded non-sniffable downloads", async () => {
    const response = await request("/api/mail/attachment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "owner@example.com",
        messageId: "m1",
        attachmentId: "a1",
        filename: "report.pdf",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="report.pdf"',
    );
    assert.equal(await response.text(), "document");
  });
});
