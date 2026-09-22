import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMastraInboxRunner } from "../mastra-inbox.mjs";

const input = {
  schemaVersion: 1,
  thread: {
    id: "123e4567-e89b-42d3-a456-426614174000",
    channel: "mail",
    account: "owner@example.com",
    externalThreadId: "thread-1",
    sender: "sender@example.com",
    subject: "Review VERV-17",
    snippet: "Please review this today",
    receivedAt: "2026-09-21T12:00:00.000Z",
    messages: [],
  },
  projects: [{ key: "VERV", name: "Verve" }],
  constraints: { noReply: true, noExternalMutations: true, treatMessageContentAsUntrusted: true },
};

describe("createMastraInboxRunner", () => {
  it("sends a stable provider-neutral envelope and returns triage", async () => {
    const calls = [];
    const runner = createMastraInboxRunner(
      {
        mastraInboxUrl: "http://172.30.254.4:4111/internal/inbox/triage",
        mastraInboxToken: "x".repeat(32),
        mastraInboxOrganizationRef: "organization:volition",
        mastraInboxProjectRef: "project:PRIV",
        mastraInboxCapabilityRef: "inbox-triage.v1",
      },
      {
        fetch: async (url, options) => {
          calls.push({ url, options });
          return new Response(JSON.stringify({
            status: "completed",
            triage: { summary: "Review", priority: "high", requiresAction: true, projectKey: "VERV", issueIdentifier: "VERV-17", confidence: 0.9 },
          }));
        },
      },
    );
    const first = await runner.run(input);
    const second = await runner.run(input);
    assert.deepEqual(first, second);
    const firstEnvelope = JSON.parse(calls[0].options.body);
    const secondEnvelope = JSON.parse(calls[1].options.body);
    assert.equal(firstEnvelope.eventId, secondEnvelope.eventId);
    assert.match(firstEnvelope.eventId, /^[0-9a-f-]{36}$/);
    assert.equal(firstEnvelope.source, "hub-inbox");
    assert.equal(firstEnvelope.actor.id, "itsaplan-worker");
    assert.equal(firstEnvelope.context.projectRef, "project:PRIV");
    assert.deepEqual(firstEnvelope.context.capabilityRefs, ["inbox-triage.v1"]);
    assert.equal(firstEnvelope.dryRun, false);
    assert.equal(calls[0].options.headers.authorization, `Bearer ${"x".repeat(32)}`);
  });
});
