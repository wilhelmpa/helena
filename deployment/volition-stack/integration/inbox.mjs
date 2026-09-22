import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";

const execFileAsync = promisify(execFile);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HISTORY_ID = /^\d{1,32}$/;

export class InboxValidationError extends Error {}

function bounded(value, maximum) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function isoTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function decodeCursor(value, baseline) {
  if (value == null || value === "") return { since: baseline, page: "" };
  if (HISTORY_ID.test(value)) return { since: value, page: "" };
  if (!value.startsWith("v1.")) throw new Error("The inbox cursor is invalid");
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8"));
    if (!HISTORY_ID.test(parsed.since) || typeof parsed.page !== "string") throw new Error();
    return { since: parsed.since, page: bounded(parsed.page, 1024) };
  } catch {
    throw new Error("The inbox cursor is invalid");
  }
}

function encodeCursor(since, page, latest) {
  if (!page) return HISTORY_ID.test(latest) ? latest : since;
  return `v1.${Buffer.from(JSON.stringify({ since, page })).toString("base64url")}`;
}

function validatePush(value, accounts) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "emailAddress,historyId,messageId,publishedAt"
  ) {
    throw new InboxValidationError("The push body is invalid");
  }
  const emailAddress = bounded(value.emailAddress, 320).toLowerCase();
  if (!EMAIL.test(emailAddress) || !accounts.includes(emailAddress)) {
    throw new InboxValidationError("The push account is invalid");
  }
  if (!HISTORY_ID.test(value.historyId)) {
    throw new InboxValidationError("The history id is invalid");
  }
  const messageId = bounded(value.messageId, 512);
  if (!messageId || messageId !== value.messageId) {
    throw new InboxValidationError("The message id is invalid");
  }
  const publishedAt = isoTimestamp(value.publishedAt);
  if (!publishedAt || publishedAt !== value.publishedAt) {
    throw new InboxValidationError("The publish timestamp is invalid");
  }
  return { emailAddress, historyId: value.historyId, messageId, publishedAt };
}

function validateSync(value, accounts) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.accounts)) {
    throw new InboxValidationError("The inbox sync body is invalid");
  }
  if (!value.cursors || typeof value.cursors !== "object" || Array.isArray(value.cursors)) {
    throw new InboxValidationError("The inbox cursors are invalid");
  }
  const requested = [...new Set(value.accounts.map((account) => bounded(account, 320).toLowerCase()))];
  if (requested.length > accounts.length || requested.some((account) => !accounts.includes(account))) {
    throw new InboxValidationError("The inbox accounts are invalid");
  }
  const limit = value.limitPerAccount;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InboxValidationError("The inbox sync limit is invalid");
  }
  const cursors = {};
  for (const account of requested) {
    const cursor = value.cursors[account] ?? null;
    if (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048)) {
      throw new InboxValidationError("The inbox cursor is invalid");
    }
    cursors[account] = cursor;
  }
  return { accounts: requested, cursors, limitPerAccount: limit };
}

function messageTimestamp(message, headers) {
  if (typeof message.internalDate === "string" && /^\d+$/.test(message.internalDate)) {
    const value = isoTimestamp(Number(message.internalDate));
    if (value) return value;
  }
  return isoTimestamp(headers.date);
}

function normalizeMessage(account, value) {
  const message = value?.message;
  const headers = value?.headers ?? {};
  if (!message || typeof message !== "object") return null;
  const id = bounded(message.id, 512);
  const threadId = bounded(message.threadId, 512);
  const receivedAt = messageTimestamp(message, headers);
  if (!id || !threadId || !receivedAt || !message.labelIds?.includes("INBOX")) return null;
  return {
    externalEventId: `gmail:${account}:${id}`.slice(0, 512),
    externalThreadId: threadId,
    externalMessageId: id,
    sender: bounded(headers.from, 500),
    subject: bounded(headers.subject, 500),
    snippet: bounded(message.snippet, 2000),
    receivedAt,
  };
}

async function mapWithConcurrency(values, limit, mapper) {
  const result = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await mapper(values[index]);
      }
    }),
  );
  return result;
}

export function createInboxService(config, options = {}) {
  const execute = options.execute ?? execFileAsync;
  const request = options.fetch ?? fetch;
  const logger = options.logger ?? console;
  let queueMutation = Promise.resolve();

  async function runGog(account, command) {
    try {
      return await execute(
        config.gogBin,
        [
          `--home=${config.gogHome}`,
          "--enable-commands-exact=gmail.history,gmail.get",
          `--account=${account}`,
          "--readonly",
          "--gmail-no-send",
          "--no-input",
          "--json",
          ...command,
        ],
        {
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          env: {
            HOME: path.dirname(config.openClawRoot),
            PATH: `${path.dirname(config.gogBin)}:/usr/local/bin:/usr/bin:/bin`,
            GOG_KEYRING_PASSWORD: config.gogKeyringPassword,
          },
        },
      );
    } catch (error) {
      const diagnostic = typeof error?.stderr === "string" ? error.stderr.toLowerCase() : "";
      logger.error("Read-only Gmail command failed", {
        account,
        operation: command.slice(0, 2).join(" "),
        code: error?.code ?? null,
        signal: error?.signal ?? null,
        killed: error?.killed === true,
        permissionDenied: diagnostic.includes("permission denied"),
        readOnlyFilesystem: diagnostic.includes("read-only file system"),
        credentialError:
          diagnostic.includes("credential") || diagnostic.includes("keyring"),
        networkError:
          diagnostic.includes("network") || diagnostic.includes("connect"),
        configurationError: diagnostic.includes("config"),
      });
      throw error;
    }
  }

  async function wakeWorker(account) {
    if (!config.inboxWorkerWakeUrl) return;
    try {
      const response = await request(config.inboxWorkerWakeUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
        headers: {
          Authorization: `Bearer ${config.inboxIntegrationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ schemaVersion: 1, channel: "mail", account }),
      });
      await response.body?.cancel();
    } catch {
      // The durable queue and five-minute pull remain the delivery guarantee.
    }
  }

  async function recordPush(input) {
    const push = validatePush(input, config.inboxAccounts);
    const operation = queueMutation.then(async () => {
      const queue = await readJson(config.inboxQueuePath, { schemaVersion: 1, pushes: {} });
      if (queue.schemaVersion !== 1 || !queue.pushes || typeof queue.pushes !== "object") {
        throw new Error("The inbox push queue has an unsupported format");
      }
      queue.pushes[push.messageId] = { ...push, receivedAt: new Date().toISOString() };
      const entries = Object.entries(queue.pushes)
        .sort((left, right) => right[1].receivedAt.localeCompare(left[1].receivedAt))
        .slice(0, 1000);
      queue.pushes = Object.fromEntries(entries);
      await writeJsonAtomic(config.inboxQueuePath, queue);
    });
    queueMutation = operation.catch(() => undefined);
    await operation;
    void wakeWorker(push.emailAddress);
  }

  async function syncAccount(account, cursorValue, maximum) {
    const cursor = decodeCursor(cursorValue, config.inboxBaselines[account]);
    const historyArgs = ["gmail", "history", `--since=${cursor.since}`, `--max=${maximum}`];
    if (cursor.page) historyArgs.push(`--page=${cursor.page}`);
    try {
      const history = JSON.parse((await runGog(account, historyArgs)).stdout);
      const ids = Array.isArray(history.messages)
        ? [...new Set(history.messages.filter((id) => typeof id === "string"))].slice(0, maximum)
        : [];
      const rows = await mapWithConcurrency(ids, 2, async (id) => {
        const output = await runGog(account, [
          "gmail",
          "get",
          id,
          "--format=metadata",
          "--headers=From,Subject,Date,Message-ID",
        ]);
        return normalizeMessage(account, JSON.parse(output.stdout));
      });
      return {
        channel: "mail",
        account,
        status: "connected",
        cursor: encodeCursor(cursor.since, bounded(history.nextPageToken, 1024), history.historyId),
        error: null,
        events: rows.filter(Boolean).slice(0, 100),
      };
    } catch {
      return {
        channel: "mail",
        account,
        status: "error",
        cursor: cursorValue,
        error: "The read-only Gmail history sync failed.",
        events: [],
      };
    }
  }

  return {
    recordPush,
    async sync(input) {
      const body = validateSync(input, config.inboxAccounts);
      const sources = [];
      for (const account of body.accounts) {
        sources.push(await syncAccount(account, body.cursors[account], body.limitPerAccount));
      }
      return { sources };
    },
  };
}
