import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createInboxService, InboxValidationError } from "../inbox.mjs";

const ACCOUNT = "owner@example.com";
let temporaryRoot;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "volition-inbox-"));
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

function config() {
  return {
    inboxAccounts: [ACCOUNT],
    inboxBaselines: { [ACCOUNT]: "100" },
    inboxQueuePath: path.join(temporaryRoot, "pushes.json"),
    inboxWorkerWakeUrl: "http://172.30.254.2:18801/internal/inbox/wake",
    inboxIntegrationToken: "integration-token-for-tests-only-0000000000",
    gogBin: "/test/gog",
    gogHome: path.join(temporaryRoot, "gog"),
    gogKeyringPassword: "keyring-password-for-tests",
    integrationStateRoot: path.join(temporaryRoot, ".integration"),
  };
}

describe("createInboxService", () => {
  it("durably deduplicates push notifications before waking the worker", async () => {
    const calls = [];
    const service = createInboxService(config(), {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return { body: { cancel: async () => {} } };
      },
    });
    const push = {
      emailAddress: ACCOUNT,
      historyId: "101",
      messageId: "push-1",
      publishedAt: "2026-09-21T00:00:00.000Z",
    };

    await service.recordPush(push);
    await service.recordPush(push);
    await new Promise((resolve) => setImmediate(resolve));

    const queue = JSON.parse(await fs.readFile(config().inboxQueuePath, "utf8"));
    assert.deepEqual(Object.keys(queue.pushes), ["push-1"]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, config().inboxWorkerWakeUrl);
    assert.equal(
      calls[0].options.headers.Authorization,
      `Bearer ${config().inboxIntegrationToken}`,
    );
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      schemaVersion: 1,
      channel: "mail",
      account: ACCOUNT,
    });
  });

  it("rejects push notifications for accounts outside the allowlist", async () => {
    const service = createInboxService(config());
    await assert.rejects(
      service.recordPush({
        emailAddress: "other@example.com",
        historyId: "101",
        messageId: "push-1",
        publishedAt: "2026-09-21T00:00:00.000Z",
      }),
      InboxValidationError,
    );
  });

  it("reads Gmail metadata with the restricted command set and returns an opaque page cursor", async () => {
    const calls = [];
    const execute = async (file, args, options) => {
      calls.push({ file, args, options });
      if (args.includes("history")) {
        return {
          stdout: JSON.stringify({
            historyId: "120",
            messages: ["message-1"],
            nextPageToken: "next-page",
          }),
        };
      }
      return {
        stdout: JSON.stringify({
          headers: {
            from: "Sender <sender@example.com>",
            subject: "A subject",
            date: "Sun, 21 Sep 2026 12:00:00 +0000",
          },
          message: {
            id: "message-1",
            threadId: "thread-1",
            internalDate: "1789992000000",
            labelIds: ["INBOX"],
            snippet: "A bounded preview",
          },
        }),
      };
    };
    const service = createInboxService(config(), { execute });

    const result = await service.sync({
      schemaVersion: 1,
      accounts: [ACCOUNT],
      cursors: { [ACCOUNT]: null },
      limitPerAccount: 50,
    });

    assert.equal(result.sources[0].status, "connected");
    assert.match(result.sources[0].cursor, /^v1\./);
    assert.deepEqual(result.sources[0].events[0], {
      externalEventId: `gmail:${ACCOUNT}:message-1`,
      externalThreadId: "thread-1",
      externalMessageId: "message-1",
      sender: "Sender <sender@example.com>",
      subject: "A subject",
      snippet: "A bounded preview",
      receivedAt: "2026-09-21T12:00:00.000Z",
    });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.file, "/test/gog");
      assert.ok(call.args.includes("--readonly"));
      assert.ok(call.args.includes("--gmail-no-send"));
      assert.ok(call.args.includes("--no-input"));
      assert.ok(call.args.includes("--enable-commands-exact=gmail.history,gmail.get"));
      assert.equal(call.options.env.GOG_KEYRING_PASSWORD, "keyring-password-for-tests");
    }
    assert.ok(calls[0].args.includes("--since=100"));
  });

  it("uses the configured baseline when a new worker has no stored cursor", async () => {
    const calls = [];
    const service = createInboxService(config(), {
      execute: async (_file, args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({ historyId: "100", messages: [] }),
        };
      },
    });

    const result = await service.sync({
      schemaVersion: 1,
      accounts: [ACCOUNT],
      cursors: {},
      limitPerAccount: 50,
    });

    assert.equal(result.sources[0].status, "connected");
    assert.equal(result.sources[0].error, null);
    assert.ok(calls[0].includes("--since=100"));
  });

  it("keeps the prior cursor when any account sync operation fails", async () => {
    const service = createInboxService(config(), {
      execute: async () => {
        throw new Error("test failure");
      },
      logger: { error() {} },
    });

    const result = await service.sync({
      schemaVersion: 1,
      accounts: [ACCOUNT],
      cursors: { [ACCOUNT]: "105" },
      limitPerAccount: 10,
    });

    assert.deepEqual(result.sources[0], {
      channel: "mail",
      account: ACCOUNT,
      status: "error",
      cursor: "105",
      error: "The read-only Gmail history sync failed.",
      events: [],
    });
  });
});
