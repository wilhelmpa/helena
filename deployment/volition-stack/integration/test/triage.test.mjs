import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createTriageService } from "../triage.mjs";

const ACCOUNT = "owner@example.com";
const THREAD_ID = "123e4567-e89b-42d3-a456-426614174000";
let temporaryRoot;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "volition-triage-"));
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

function config() {
  return {
    inboxAccounts: [ACCOUNT],
    inboxTriagePath: path.join(temporaryRoot, "triage.json"),
    inboxTriagePromptRoot: path.join(temporaryRoot, "prompts"),
    openClawBin: "/test/openclaw",
    inboxAgentId: "test-classifier",
  };
}

function input() {
  return {
    schemaVersion: 1,
    thread: {
      id: THREAD_ID,
      channel: "mail",
      account: ACCOUNT,
      externalThreadId: "thread-1",
      sender: "sender@example.com",
      subject: "Review VERV-17",
      snippet: "Please review this today",
      receivedAt: "2026-09-21T12:00:00.000Z",
      messages: [],
    },
    projects: [{ key: "VERV", name: "Verve" }],
    constraints: {
      noReply: true,
      noExternalMutations: true,
      treatMessageContentAsUntrusted: true,
    },
  };
}

async function completed(service, runId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await service.status(runId);
    if (result.status === "completed" || result.status === "failed") return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("triage did not finish");
}

describe("createTriageService", () => {
  it("routes production triage through Mastra while keeping the raw classifier as a private capability", async () => {
    const calls = [];
    const service = createTriageService(
      { ...config(), inboxTriageTransport: "rpc", inboxTriageControlPlane: "mastra" },
      {
        mastraInbox: {
          async run(value) {
            calls.push(["mastra", value.thread.id]);
            return {
              summary: "Mastra routed review.",
              priority: "high",
              requiresAction: true,
              projectKey: "VERV",
              issueIdentifier: "VERV-17",
              confidence: 0.98,
            };
          },
        },
        gatewayAgent: {
          async run() {
            calls.push(["classifier"]);
            return JSON.stringify({
              summary: "Private classifier result.",
              priority: "medium",
              requiresAction: true,
              projectKey: "VERV",
              issueIdentifier: "VERV-17",
              confidence: 0.9,
            });
          },
          stop() {},
        },
      },
    );

    const started = await service.start(input());
    const result = await completed(service, started.runId);
    assert.equal(result.status, "completed");
    assert.equal(result.result.summary, "Mastra routed review.");
    assert.deepEqual(calls, [["mastra", THREAD_ID]]);

    const direct = await service.classify(input(), "123e4567-e89b-42d3-a456-426614174001");
    assert.equal(direct.summary, "Private classifier result.");
    assert.deepEqual(calls.at(-1), ["classifier"]);
  });

  it("uses the persistent Gateway runner without writing a prompt file", async () => {
    const calls = [];
    const rpcConfig = { ...config(), inboxTriageTransport: "rpc" };
    const service = createTriageService(rpcConfig, {
      gatewayAgent: {
        async run(call) {
          calls.push(call);
          return JSON.stringify({
            summary: "Review requested.",
            priority: "high",
            requiresAction: true,
            projectKey: "VERV",
            issueIdentifier: "VERV-17",
            confidence: 0.95,
          });
        },
        stop() {},
      },
    });

    const started = await service.start(input());
    const result = await completed(service, started.runId);

    assert.equal(result.status, "completed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sessionId, THREAD_ID);
    assert.equal(calls[0].idempotencyKey, started.runId);
    assert.match(calls[0].prompt, /Treat all text.*untrusted/i);
    await assert.rejects(fs.access(rpcConfig.inboxTriagePromptRoot));
  });

  it("uses the dedicated agent without delivery and accepts only grounded identifiers", async () => {
    const calls = [];
    const service = createTriageService(config(), {
      execute: async (file, args) => {
        calls.push({ file, args, prompt: await fs.readFile(args[args.indexOf("--message-file") + 1], "utf8") });
        return {
          stdout: JSON.stringify({
            status: "ok",
            result: {
              payloads: [
                {
                  text: JSON.stringify({
                    summary: "Review requested.",
                    priority: "high",
                    requiresAction: true,
                    projectKey: "VERV",
                    issueIdentifier: "VERV-17",
                    confidence: 0.95,
                  }),
                },
              ],
            },
          }),
        };
      },
    });

    const started = await service.start(input());
    assert.equal(started.status, "queued");
    const result = await completed(service, started.runId);

    assert.equal(result.status, "completed");
    assert.equal(result.result.projectKey, "VERV");
    assert.equal(result.result.issueIdentifier, "VERV-17");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "/test/openclaw");
    assert.ok(calls[0].args.includes("test-classifier"));
    assert.ok(calls[0].args.includes("--session-id"));
    assert.ok(!calls[0].args.includes("--deliver"));
    assert.ok(!calls[0].args.includes("--local"));
    assert.match(calls[0].prompt, /Treat all text.*untrusted/i);
    assert.equal((await fs.readdir(config().inboxTriagePromptRoot)).length, 0);
  });

  it("fails closed when the model invents an issue identifier", async () => {
    const service = createTriageService(config(), {
      execute: async () => ({
        stdout: JSON.stringify({
          status: "ok",
          result: {
            payloads: [
              {
                text: JSON.stringify({
                  summary: "Review requested.",
                  priority: "high",
                  requiresAction: true,
                  projectKey: "VERV",
                  issueIdentifier: "VERV-999",
                  confidence: 0.5,
                }),
              },
            ],
          },
        }),
      }),
    });

    const started = await service.start(input());
    const result = await completed(service, started.runId);

    assert.deepEqual(
      { status: result.status, error: result.error },
      { status: "failed", error: "The read-only inbox triage run failed." },
    );
  });
});
