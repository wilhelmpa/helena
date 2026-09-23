import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createProvisioningServer } from "../server.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- inert test fixture
const INBOX_TOKEN = "inbox-integration-token-0123456789abcdef";
const PUSH_TOKEN = "inbox-push-token-0123456789abcdef00000";
const MASTRA_TOKEN = "mastra-inbox-token-0123456789abcdef000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";
let server;
let origin;
let calls;
let inboxCalls;

beforeEach(async () => {
  calls = 0;
  inboxCalls = [];
  server = createProvisioningServer(
    {
      token: TOKEN,
      inboxAccounts: ["owner@example.com"],
      inboxIntegrationToken: INBOX_TOKEN,
      inboxPushToken: PUSH_TOKEN,
      mastraInboxToken: MASTRA_TOKEN,
      mastraInboxOrganizationRef: "organization:volition",
      mastraInboxProjectRef: "project:PRIV",
      mastraInboxCapabilityRef: "inbox-triage.v1",
    },
    {
      provisioner: {
        async provision(envelope) {
          calls += 1;
          return {
            resources: [
              { kind: "registry", id: `project:${envelope.project.key}` },
            ],
          };
        },
        async deprovision(envelope) {
          calls += 1;
          return {
            resources: [{ kind: "workspace", id: `quarantine:${envelope.project.key}` }],
          };
        },
        async state() {
          return { projects: [{ project: { id: 7 }, requestedResources: [], boards: [], browserActive: null }] };
        },
      },
      inbox: {
        async recordPush(value) {
          inboxCalls.push(["push", value]);
        },
        async sync(value) {
          inboxCalls.push(["sync", value]);
          return { sources: [] };
        },
      },
      triage: {
        async start(value) {
          inboxCalls.push(["triage", value]);
          return { status: "queued", runId: "run-1" };
        },
        async status(runId) {
          return runId === "run-1"
            ? { status: "completed", result: { summary: "done" } }
            : null;
        },
        async classify(value, eventId) {
          inboxCalls.push(["classify", value, eventId]);
          return { summary: "classified", priority: null, requiresAction: false, projectKey: null, issueIdentifier: null, confidence: 0.9 };
        },
      },
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function body(project = {}) {
  return {
    eventId: EVENT_ID,
    eventType: "project.provision",
    project: {
      id: 7,
      key: "DEMO",
      name: "Demo",
      description: "",
      teamId: 3,
      ...project,
    },
    requestedResources: ["workspace", "terminal"],
    createdAt: "2026-09-21T00:00:00.000Z",
  };
}

function request(payload, headers = {}) {
  return fetch(`${origin}/api/provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": EVENT_ID,
      "X-Itsaplan-Event": "project.provision",
      "X-Itsaplan-Event-Id": EVENT_ID,
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

describe("provisioning server", () => {
  it("accepts the authenticated worker envelope", async () => {
    const response = await request(body());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resources: [{ kind: "registry", id: "project:DEMO" }],
    });
    assert.equal(calls, 1);
  });

  it("routes an authenticated deprovisioning envelope to cleanup", async () => {
    const payload = { ...body(), eventType: "project.deprovision" };
    const response = await request(payload, { "X-Itsaplan-Event": "project.deprovision" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resources: [{ kind: "workspace", id: "quarantine:DEMO" }],
    });
    assert.equal(calls, 1);
  });

  it("reports the provisioned projects to an authenticated caller only", async () => {
    const denied = await fetch(`${origin}/api/provision/state`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${origin}/api/provision/state`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).projects.map((entry) => entry.project.id), [7]);
  });

  it("rejects missing authentication before parsing the request", async () => {
    const response = await request(body(), { Authorization: "" });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });

  it("rejects a project key that could escape a workspace root", async () => {
    const response = await request(body({ key: "../HOME" }));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });

  it("keeps push and worker sync behind separate bearer tokens", async () => {
    const pushBody = {
      emailAddress: "owner@example.com",
      historyId: "101",
      messageId: "push-1",
      publishedAt: "2026-09-21T00:00:00.000Z",
    };
    const push = await fetch(`${origin}/inbox/gmail/push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PUSH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pushBody),
    });
    assert.equal(push.status, 204);

    const syncBody = {
      schemaVersion: 1,
      accounts: ["owner@example.com"],
      cursors: { "owner@example.com": null },
      limitPerAccount: 50,
    };
    const sync = await fetch(`${origin}/api/inbox/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INBOX_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(syncBody),
    });
    assert.equal(sync.status, 200);
    assert.deepEqual(await sync.json(), { sources: [] });
    assert.deepEqual(inboxCalls, [
      ["push", pushBody],
      ["sync", syncBody],
    ]);

    const crossedTokens = await fetch(`${origin}/api/inbox/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PUSH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(syncBody),
    });
    assert.equal(crossedTokens.status, 401);
  });

  it("starts and polls authenticated asynchronous triage", async () => {
    const payload = { schemaVersion: 1 };
    const started = await fetch(`${origin}/api/inbox/triage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INBOX_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(started.status, 202);
    assert.deepEqual(await started.json(), { status: "queued", runId: "run-1" });

    const finished = await fetch(`${origin}/api/inbox/triage/run-1`, {
      headers: { Authorization: `Bearer ${INBOX_TOKEN}` },
    });
    assert.equal(finished.status, 200);
    assert.deepEqual(await finished.json(), {
      status: "completed",
      result: { summary: "done" },
    });
    assert.deepEqual(inboxCalls, [["triage", payload]]);
  });

  it("keeps the Mastra classifier callback private and capability-scoped", async () => {
    const payload = {
      schemaVersion: 1,
      capability: "inbox-triage.v1",
      context: {
        organizationRef: "organization:volition",
        projectRef: "project:PRIV",
        capabilityRefs: ["inbox-triage.v1"],
        connectionRefs: [],
      },
      eventId: EVENT_ID,
      correlationId: EVENT_ID,
      payload: { thread: { id: EVENT_ID } },
    };
    const unauthorized = await fetch(`${origin}/internal/mastra/inbox/classify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INBOX_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`${origin}/internal/mastra/inbox/classify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MASTRA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.summary, "classified");
    assert.deepEqual(inboxCalls.at(-1), ["classify", payload.payload, EVENT_ID]);
  });
});
