import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { createTriageService, InboxValidationError } from "../triage.mjs";

const RESULT = { summary: "ok", priority: null, requiresAction: false, projectKey: null, issueIdentifier: null, confidence: 1 };

let root;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-triage-"));
});
after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function triageInput(account) {
  return { schemaVersion: 1, thread: { id: "123e4567-e89b-42d3-a456-426614174000", account, channel: "mail", externalThreadId: "t", sender: "", subject: "", snippet: "", receivedAt: "2026-01-01T00:00:00.000Z", messages: [] }, projects: [], constraints: { noReply: true, noExternalMutations: true, treatMessageContentAsUntrusted: true } };
}

function triageService(name, options = {}) {
  return createTriageService({ inboxAccounts: ["owner@example.com"], inboxTriagePath: path.join(root, `${name}.json`) }, options);
}

async function finished(service, runId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.status(runId);
    if (job.status !== "queued" && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The triage run did not finish");
}

it("classifies with the classifier it is given and stores the validated result", async () => {
  const service = triageService("given", { classifier: { run: async () => RESULT } });
  const { runId } = await service.start(triageInput("Owner@Example.com"));
  const job = await finished(service, runId);
  assert.equal(job.status, "completed");
  assert.deepEqual(job.result, RESULT);
});

it("fails a run with a clear message while no classifier is configured", async () => {
  const service = triageService("none");
  const { runId } = await service.start(triageInput("owner@example.com"));
  const job = await finished(service, runId);
  assert.equal(job.status, "failed");
  assert.equal(job.error, "No inbox classifier is configured.");
});

it("refuses a mail account that triage is not switched on for", async () => {
  await assert.rejects(
    triageService("refused", { classifier: { run: async () => RESULT } }).start(triageInput("other@example.com")),
    InboxValidationError,
  );
});
