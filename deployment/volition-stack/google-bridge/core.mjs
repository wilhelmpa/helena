import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_MAIL_ACCOUNTS = Object.freeze([
  "owner@example.com",
  "archive@example.com",
  "personal@example.com",
]);
const DEFAULT_CALENDAR_ACCOUNT = "personal@example.com";
const GMAIL_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9:./_-]{0,255}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class GoogleBridgeValidationError extends Error {}

function exactObject(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleBridgeValidationError("Input must be an object");
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new GoogleBridgeValidationError(`Unexpected field: ${unexpected[0]}`);
  }
}

function boundedText(value, name, maximum, pattern = null) {
  if (typeof value !== "string" || !value || value.length > maximum || /[\0\r\n]/.test(value)) {
    throw new GoogleBridgeValidationError(`${name} is invalid`);
  }
  if (pattern && !pattern.test(value)) throw new GoogleBridgeValidationError(`${name} is invalid`);
  return value;
}

function positiveInteger(value, name, maximum, fallback) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) {
    throw new GoogleBridgeValidationError(`${name} is invalid`);
  }
  return selected;
}

function timestamp(value, name) {
  boundedText(value, name, 64, RFC3339);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new GoogleBridgeValidationError(`${name} is invalid`);
  return parsed;
}

function allowedAccount(value, accounts) {
  const account = boundedText(value, "account", 320).toLowerCase();
  if (!accounts.includes(account)) throw new GoogleBridgeValidationError("account is not allowed");
  return account;
}

function parseOutput(stdout) {
  if (Buffer.byteLength(stdout || "") > 2 * 1024 * 1024) throw new Error("Google result is too large");
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Google returned invalid JSON");
  }
}

function limited(value, depth = 0) {
  if (depth > 10) return null;
  if (typeof value === "string") return value.slice(0, 50_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => limited(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["raw", "accessToken", "refreshToken"].includes(key))
      .slice(0, 100)
      .map(([key, item]) => [key, limited(item, depth + 1)]),
  );
}

function allObjects(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) allObjects(item, result);
  } else {
    result.push(value);
    for (const item of Object.values(value)) allObjects(item, result);
  }
  return result;
}

function extractEvents(value) {
  const candidates = [];
  for (const object of allObjects(value)) {
    if (
      typeof object.id === "string" &&
      object.start && typeof object.start === "object" &&
      object.end && typeof object.end === "object"
    ) {
      candidates.push(object);
    }
  }
  return candidates.slice(0, 25);
}

function eventTimestamp(value) {
  return value?.dateTime || value?.date || "";
}

function publicEvent(event) {
  return {
    id: String(event.id || "").slice(0, 512),
    summary: String(event.summary || "").slice(0, 200),
    start: eventTimestamp(event.start).slice(0, 64),
    end: eventTimestamp(event.end).slice(0, 64),
    status: String(event.status || "").slice(0, 32),
  };
}

export function createGoogleBridge(options = {}) {
  const execute = options.execute ?? execFileAsync;
  const readWrapper = options.readWrapper ?? "/home/pw/.local/bin/gog-openclaw-read";
  const writeWrapper = options.writeWrapper ?? "/home/pw/.local/bin/gog-openclaw-write";
  const mailAccounts = Object.freeze([...(options.mailAccounts ?? DEFAULT_MAIL_ACCOUNTS)].map((x) => x.toLowerCase()));
  const calendarReadAccounts = mailAccounts;
  const calendarAccount = (options.calendarAccount ?? DEFAULT_CALENDAR_ACCOUNT).toLowerCase();
  if (!mailAccounts.includes(calendarAccount)) throw new Error("Calendar account must be mail-allowlisted");

  async function run(wrapper, account, commandName, args) {
    try {
      const result = await execute(
        wrapper,
        [
          `--account=${account}`,
          `--enable-commands-exact=${commandName}`,
          "--json",
          "--results-only",
          ...args,
        ],
        {
          shell: false,
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: "utf8",
          env: {
            HOME: "/home/pw",
            PATH: "/home/pw/.local/bin:/usr/local/bin:/usr/bin:/bin",
          },
        },
      );
      return parseOutput(result.stdout);
    } catch (error) {
      if (error instanceof GoogleBridgeValidationError) throw error;
      const wrapped = new Error("The Google connector request failed");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function gmailThreadGet(input) {
    exactObject(input, ["account", "threadId"]);
    const account = allowedAccount(input.account, mailAccounts);
    const threadId = boundedText(input.threadId, "threadId", 256, GMAIL_ID);
    const result = await run(readWrapper, account, "gmail.thread.get", [
      "gmail", "thread", "get", threadId, "--sanitize-content",
    ]);
    return limited(result);
  }

  async function gmailSearch(input) {
    exactObject(input, ["account", "query", "maxResults"]);
    const account = allowedAccount(input.account, mailAccounts);
    const query = boundedText(input.query?.trim(), "query", 500);
    if (query.startsWith("-")) throw new GoogleBridgeValidationError("query is invalid");
    const maximum = positiveInteger(input.maxResults, "maxResults", 20, 10);
    const result = await run(readWrapper, account, "gmail.search", [
      "gmail", "search", query, `--max=${maximum}`,
    ]);
    return limited(result);
  }

  async function gmailAttachmentMetadata(input) {
    exactObject(input, ["account", "messageId"]);
    const account = allowedAccount(input.account, mailAccounts);
    const messageId = boundedText(input.messageId, "messageId", 256, GMAIL_ID);
    const result = await run(readWrapper, account, "gmail.get", [
      "gmail", "get", messageId, "--format=full", "--sanitize-content",
    ]);
    const attachments = [];
    for (const part of allObjects(result)) {
      const attachmentId = part?.body?.attachmentId;
      const filename = part?.filename;
      if (typeof attachmentId !== "string" || typeof filename !== "string" || !filename) continue;
      attachments.push({
        messageId,
        attachmentId: attachmentId.slice(0, 512),
        filename: filename.slice(0, 500),
        mimeType: String(part.mimeType || "application/octet-stream").slice(0, 255),
        size: Number.isSafeInteger(part.body?.size) && part.body.size >= 0 ? part.body.size : null,
      });
    }
    return { messageId, attachments: attachments.slice(0, 50) };
  }

  async function contactsSearch(input) {
    exactObject(input, ["account", "query", "maxResults"]);
    const account = allowedAccount(input.account, mailAccounts);
    const query = boundedText(input.query?.trim(), "query", 200);
    if (query.startsWith("-")) throw new GoogleBridgeValidationError("query is invalid");
    const maximum = positiveInteger(input.maxResults, "maxResults", 25, 10);
    return limited(await run(readWrapper, account, "contacts.search", [
      "contacts", "search", query, `--max=${maximum}`,
    ]));
  }

  async function calendarList(input) {
    exactObject(input, ["account", "from", "to", "query", "maxResults"]);
    const account = allowedAccount(input.account, calendarReadAccounts);
    const from = timestamp(input.from, "from");
    const to = timestamp(input.to, "to");
    if (to <= from || to - from > 31 * 24 * 60 * 60 * 1000) {
      throw new GoogleBridgeValidationError("calendar window is invalid");
    }
    const maximum = positiveInteger(input.maxResults, "maxResults", 25, 10);
    const args = [
      "calendar", "events", "primary",
      `--from=${input.from}`, `--to=${input.to}`, `--max=${maximum}`,
    ];
    if (input.query !== undefined) args.push(`--query=${boundedText(input.query.trim(), "query", 200)}`);
    const result = await run(readWrapper, account, "calendar.events", args);
    return { events: extractEvents(result).map(publicEvent) };
  }

  async function calendarUpsertConfirmed(input) {
    exactObject(input, ["account", "confirmed", "sourceId", "summary", "start", "durationMinutes"]);
    const account = allowedAccount(input.account, [calendarAccount]);
    if (input.confirmed !== true) throw new GoogleBridgeValidationError("confirmed must be true");
    const sourceId = boundedText(input.sourceId, "sourceId", 256, SOURCE_ID);
    const summary = boundedText(input.summary?.trim(), "summary", 160);
    const start = timestamp(input.start, "start");
    const duration = positiveInteger(input.durationMinutes, "durationMinutes", 480, 60);
    const end = new Date(start.getTime() + duration * 60_000);
    const hash = crypto.createHash("sha256").update(sourceId).digest("hex");
    const from = new Date(start.getTime() - 12 * 60 * 60_000).toISOString();
    const to = new Date(start.getTime() + 36 * 60 * 60_000).toISOString();
    const sourceListed = await run(readWrapper, account, "calendar.events", [
      "calendar", "events", "primary", `--from=${from}`, `--to=${to}`, "--max=25",
      `--private-prop-filter=volitionSourceHash=${hash}`,
    ]);
    const sourceMatch = extractEvents(sourceListed)[0];
    const listed = sourceMatch ? null : await run(readWrapper, account, "calendar.events", [
      "calendar", "events", "primary", `--from=${from}`, `--to=${to}`, "--max=25",
    ]);
    const events = listed ? extractEvents(listed) : [];
    const exactMatch = events.find((event) =>
      String(event.summary || "") === summary &&
      new Date(eventTimestamp(event.start)).getTime() === start.getTime(),
    );
    const existing = sourceMatch || exactMatch;
    if (exactMatch && !sourceMatch) {
      return { action: "conflict", reason: "unmanaged_event_collision", event: publicEvent(exactMatch) };
    }
    if (
      sourceMatch &&
      (
        (Array.isArray(sourceMatch.attendees) && sourceMatch.attendees.length > 0) ||
        sourceMatch.recurringEventId ||
        (Array.isArray(sourceMatch.recurrence) && sourceMatch.recurrence.length > 0) ||
        sourceMatch.organizer?.self !== true
      )
    ) {
      return { action: "conflict", reason: "managed_event_is_not_personal", event: publicEvent(sourceMatch) };
    }
    const common = [
      `--summary=${summary}`,
      `--from=${input.start}`,
      `--to=${end.toISOString()}`,
      "--timezone=Europe/Berlin",
      "--send-updates=none",
      `--private-prop=volitionSourceHash=${hash}`,
      "--private-prop=volitionSourceType=linkedin",
    ];
    if (
      existing &&
      String(existing.summary || "") === summary &&
      new Date(eventTimestamp(existing.start)).getTime() === start.getTime() &&
      new Date(eventTimestamp(existing.end)).getTime() === end.getTime() &&
      Boolean(sourceMatch)
    ) {
      return { action: "unchanged", event: publicEvent(existing) };
    }
    const result = existing
      ? await run(writeWrapper, account, "calendar.update", [
          "calendar", "update", "primary", boundedText(existing.id, "eventId", 512, GMAIL_ID), ...common,
        ])
      : await run(writeWrapper, account, "calendar.create", [
          "calendar", "create", "primary", ...common,
        ]);
    const changed = extractEvents(result)[0] ?? result;
    return { action: existing ? "updated" : "created", event: publicEvent(changed) };
  }

    return {
    mailAccounts,
    calendarReadAccounts,
    calendarAccount,
    gmailThreadGet,
    gmailSearch,
    gmailAttachmentMetadata,
    contactsSearch,
    calendarList,
    // Intentionally not registered as an MCP tool. A future caller must add a
    // server-side owner approval record before exposing calendar writes.
    calendarUpsertConfirmed,
  };
}
