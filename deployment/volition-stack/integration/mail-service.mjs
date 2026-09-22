import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GMAIL_ID = /^[A-Za-z0-9_-]{1,512}$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const LABEL = /^[^\0\r\n,]{1,200}$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SEND_AUTH_TTL_MS = 2 * 60 * 1000;

export class MailValidationError extends Error {}

function exactObject(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MailValidationError("Input must be an object");
  }
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new MailValidationError(`Unexpected field: ${extra}`);
}

function text(value, name, maximum, pattern = null, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new MailValidationError(`${name} is invalid`);
  }
  if (pattern && !pattern.test(value)) throw new MailValidationError(`${name} is invalid`);
  return value;
}

function account(value, allowed) {
  const selected = text(value, "account", 320).toLowerCase();
  if (!allowed.includes(selected)) throw new MailValidationError("account is not allowed");
  return selected;
}

function recipients(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new MailValidationError(`${name} is invalid`);
  return value.map((item) => text(item, name, 320, EMAIL));
}

function parseJson(stdout) {
  if (Buffer.byteLength(stdout || "") > MAX_JSON_BYTES) throw new Error("Mail result is too large");
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Mail connector returned invalid JSON");
  }
}

function limited(value, depth = 0) {
  if (depth > 10) return null;
  if (typeof value === "string") return value.slice(0, 100_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => limited(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/token|secret|credential|raw|contentBase64/i.test(key))
      .slice(0, 200)
      .map(([key, item]) => [key, limited(item, depth + 1)]),
  );
}

function safeFilename(value) {
  return path.basename(String(value || "attachment")).replace(/[\0\r\n"\\]/g, "_").slice(0, 180) || "attachment";
}

export function createMailService(config, options = {}) {
  const execute = options.execute ?? execFileAsync;
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const accounts = Object.freeze([...(config.inboxAccounts ?? [])].map((item) => item.toLowerCase()));
  const authorizations = new Map();

  async function run(selectedAccount, commandName, command, { readonly = true, maxBuffer = MAX_JSON_BYTES } = {}) {
    try {
      const result = await execute(
        config.gogBin,
        [
          `--home=${config.gogHome}`,
          `--enable-commands-exact=${commandName}`,
          `--account=${selectedAccount}`,
          ...(readonly ? ["--readonly", "--gmail-no-send"] : []),
          "--no-input",
          "--json",
          "--results-only",
          ...command,
        ],
        {
          timeout: 60_000,
          maxBuffer,
          encoding: "utf8",
          env: {
            HOME: path.dirname(config.openClawRoot),
            PATH: `${path.dirname(config.gogBin)}:/usr/local/bin:/usr/bin:/bin`,
            GOG_KEYRING_PASSWORD: config.gogKeyringPassword,
          },
          shell: false,
        },
      );
      return parseJson(result.stdout);
    } catch (error) {
      if (error instanceof MailValidationError) throw error;
      const message = String(error?.stderr || "").toLowerCase();
      const wrapped = new Error(
        message.includes("scope") || message.includes("permission")
          ? "The Google account does not grant this operation"
          : "The Google mail connector request failed",
      );
      wrapped.code = message.includes("scope") || message.includes("permission") ? "unsupported_scope" : "connector_failed";
      throw wrapped;
    }
  }

  async function accountsStatus() {
    const result = [];
    for (const item of accounts) {
      try {
        await run(item, "gmail.labels.list", ["gmail", "labels", "list"]);
        result.push({ account: item, status: "connected", lastCheckedAt: new Date(now()).toISOString(), lastError: null });
      } catch (error) {
        result.push({ account: item, status: error.code === "unsupported_scope" ? "unsupported" : "error", lastCheckedAt: new Date(now()).toISOString(), lastError: error.message });
      }
    }
    return { accounts: result };
  }

  async function search(input) {
    exactObject(input, ["account", "query", "maxResults", "page"]);
    const selected = account(input.account, accounts);
    const query = text(input.query ?? "in:anywhere", "query", 500);
    const maximum = input.maxResults ?? 25;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50) throw new MailValidationError("maxResults is invalid");
    const args = ["gmail", "search", query, `--max=${maximum}`];
    if (input.page !== undefined) args.push(`--page=${text(input.page, "page", 2048)}`);
    return limited(await run(selected, "gmail.search", args));
  }

  async function getThread(input) {
    exactObject(input, ["account", "threadId"]);
    const selected = account(input.account, accounts);
    const threadId = text(input.threadId, "threadId", 512, GMAIL_ID);
    const [thread, attachments] = await Promise.all([
      run(selected, "gmail.thread.get", ["gmail", "thread", "get", threadId, "--full", "--sanitize-content"]),
      run(selected, "gmail.thread.attachments", ["gmail", "thread", "attachments", threadId]),
    ]);
    return { thread: limited(thread), attachments: limited(attachments) };
  }

  async function labels(input) {
    exactObject(input, ["account"]);
    return limited(await run(account(input.account, accounts), "gmail.labels.list", ["gmail", "labels", "list"]));
  }

  async function modifyLabels(input) {
    exactObject(input, ["account", "threadId", "add", "remove"]);
    const selected = account(input.account, accounts);
    const args = ["gmail", "thread", "modify", text(input.threadId, "threadId", 512, GMAIL_ID)];
    if (input.add !== undefined && !Array.isArray(input.add)) throw new MailValidationError("labels are invalid");
    if (input.remove !== undefined && !Array.isArray(input.remove)) throw new MailValidationError("labels are invalid");
    const add = (input.add ?? []).map((item) => text(item, "label", 200, LABEL));
    const remove = (input.remove ?? []).map((item) => text(item, "label", 200, LABEL));
    if (add.length + remove.length < 1 || add.length + remove.length > 40) throw new MailValidationError("labels are invalid");
    if (add.length) args.push(`--add=${add.join(",")}`);
    if (remove.length) args.push(`--remove=${remove.join(",")}`);
    return limited(await run(selected, "gmail.thread.modify", args, { readonly: false }));
  }

  async function createDraft(input) {
    exactObject(input, ["account", "to", "cc", "bcc", "subject", "body", "replyToMessageId", "threadId", "replyAll"]);
    const selected = account(input.account, accounts);
    const to = recipients(input.to, "to");
    const cc = recipients(input.cc, "cc");
    const bcc = recipients(input.bcc, "bcc");
    const body = text(input.body, "body", 100_000, null, true);
    const args = ["gmail", "drafts", "create", `--subject=${text(input.subject, "subject", 998)}`, `--body=${body}`];
    if (to.length) args.push(`--to=${to.join(",")}`);
    if (cc.length) args.push(`--cc=${cc.join(",")}`);
    if (bcc.length) args.push(`--bcc=${bcc.join(",")}`);
    if (input.replyToMessageId !== undefined) args.push(`--reply-to-message-id=${text(input.replyToMessageId, "replyToMessageId", 512, GMAIL_ID)}`);
    if (input.threadId !== undefined) args.push(`--thread-id=${text(input.threadId, "threadId", 512, GMAIL_ID)}`);
    if (input.replyAll === true) args.push("--reply-all");
    if (!to.length && input.replyAll !== true) throw new MailValidationError("At least one recipient is required");
    return limited(await run(selected, "gmail.drafts.create", args, { readonly: false }));
  }

  async function listDrafts(input) {
    exactObject(input, ["account", "maxResults"]);
    const selected = account(input.account, accounts);
    const maximum = input.maxResults ?? 25;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50) throw new MailValidationError("maxResults is invalid");
    return limited(await run(selected, "gmail.drafts.list", ["gmail", "drafts", "list", `--max=${maximum}`]));
  }

  async function authorizeSend(input) {
    exactObject(input, ["account", "draftId"]);
    const selected = account(input.account, accounts);
    const draftId = text(input.draftId, "draftId", 512, GMAIL_ID);
    const draft = limited(await run(selected, "gmail.drafts.get", ["gmail", "drafts", "get", draftId]));
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now() + SEND_AUTH_TTL_MS;
    authorizations.set(crypto.createHash("sha256").update(token).digest("hex"), { selected, draftId, expiresAt });
    return { confirmationToken: token, expiresAt: new Date(expiresAt).toISOString(), draft };
  }

  async function sendDraft(input) {
    exactObject(input, ["account", "draftId", "confirmationToken"]);
    const selected = account(input.account, accounts);
    const draftId = text(input.draftId, "draftId", 512, GMAIL_ID);
    const token = text(input.confirmationToken, "confirmationToken", 128);
    const key = crypto.createHash("sha256").update(token).digest("hex");
    const grant = authorizations.get(key);
    authorizations.delete(key);
    if (!grant || grant.selected !== selected || grant.draftId !== draftId || grant.expiresAt < now()) {
      throw new MailValidationError("Send confirmation is invalid or expired");
    }
    return limited(await run(selected, "gmail.drafts.send", ["gmail", "drafts", "send", draftId], { readonly: false }));
  }

  async function attachment(input) {
    exactObject(input, ["account", "messageId", "attachmentId", "filename"]);
    const selected = account(input.account, accounts);
    const messageId = text(input.messageId, "messageId", 512, GMAIL_ID);
    const attachmentId = text(input.attachmentId, "attachmentId", 512, GMAIL_ID);
    const result = await run(selected, "gmail.attachment", ["gmail", "attachment", messageId, attachmentId, "--inline", `--inline-max-bytes=${MAX_ATTACHMENT_BYTES}`], { maxBuffer: MAX_ATTACHMENT_BYTES * 2 });
    const content = result?.contentBase64;
    if (typeof content !== "string") throw new Error("Attachment is unavailable for inline download");
    const bytes = Buffer.from(content, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds the download limit");
    return { bytes, filename: safeFilename(input.filename), contentType: "application/octet-stream" };
  }

  return { accountsStatus, search, getThread, labels, modifyLabels, createDraft, listDrafts, authorizeSend, sendDraft, attachment };
}
