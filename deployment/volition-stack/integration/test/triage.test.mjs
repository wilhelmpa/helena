import assert from "node:assert/strict";
import { it } from "node:test";
import { createTriageService, InboxValidationError } from "../triage.mjs";

const RESULT = { summary: "ok", priority: null, requiresAction: false, projectKey: null, issueIdentifier: null, confidence: 1 };

function triageInput(account) {
  return { schemaVersion: 1, thread: { id: "123e4567-e89b-42d3-a456-426614174000", account, channel: "mail", externalThreadId: "t", sender: "", subject: "", snippet: "", receivedAt: "2026-01-01T00:00:00.000Z", messages: [] }, projects: [], constraints: { noReply: true, noExternalMutations: true, treatMessageContentAsUntrusted: true } };
}

function triageService() {
  return createTriageService({ inboxAccounts: ["owner@example.com"], inboxTriagePath: "/tmp/volition-triage-test.json" }, { mastraInbox: { run: async () => RESULT } });
}

it("uses the Mastra runner for classification", async () => {
  const result = await triageService().classify(triageInput("Owner@Example.com"), "123e4567-e89b-42d3-a456-426614174001");
  assert.equal(result.summary, "ok");
});

it("refuses a mail account that triage is not switched on for", async () => {
  await assert.rejects(
    triageService().classify(triageInput("other@example.com"), "123e4567-e89b-42d3-a456-426614174001"),
    InboxValidationError,
  );
});
