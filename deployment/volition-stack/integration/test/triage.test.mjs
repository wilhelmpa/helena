import assert from "node:assert/strict";
import { it } from "node:test";
import { createTriageService } from "../triage.mjs";

it("uses the Mastra runner for classification", async () => {
  const result = await createTriageService({ inboxAccounts: ["owner@example.com"], inboxTriagePath: "/tmp/volition-triage-test.json" }, { mastraInbox: { run: async () => ({ summary: "ok", priority: null, requiresAction: false, projectKey: null, issueIdentifier: null, confidence: 1 }) } }).classify({ schemaVersion: 1, thread: { id: "123e4567-e89b-42d3-a456-426614174000", account: "owner@example.com", channel: "mail", externalThreadId: "t", sender: "", subject: "", snippet: "", receivedAt: "2026-01-01T00:00:00.000Z", messages: [] }, projects: [], constraints: { noReply: true, noExternalMutations: true, treatMessageContentAsUntrusted: true } }, "123e4567-e89b-42d3-a456-426614174001");
  assert.equal(result.summary, "ok");
});
